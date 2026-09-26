import { aiChat, aiChatCancel, aiChatStream } from '../../api'
import type { ChatRequest, ChatResponse } from '../../types'

export interface StreamChunkEvent {
  streamId: string
  delta: string
  finishReason: string | null
  done: boolean
  promptTokens: number | null
  completionTokens: number | null
}

export interface StreamErrorEvent {
  streamId: string
  message: string
  retryable: boolean
}

export interface StreamTerminalEvent {
  streamId: string
}

export type StreamStatus = 'idle' | 'streaming' | 'completed' | 'cancelled' | 'failed'

export interface StreamSession {
  streamId: string
  status: StreamStatus
  content: string
  finishReason: string | null
  promptTokens: number | null
  completionTokens: number | null
  errorMessage: string | null
  retryable: boolean
}

/**
 * Reduce a sequence of streaming events into a single immutable session
 * snapshot. Pure function — no Tauri imports, fully testable.
 */
export function reduceStreamSession(
  current: StreamSession | null,
  event:
    | { type: 'start'; streamId: string }
    | { type: 'chunk'; chunk: StreamChunkEvent }
    | { type: 'done'; terminal: StreamTerminalEvent }
    | { type: 'cancelled'; terminal: StreamTerminalEvent }
    | { type: 'error'; error: StreamErrorEvent },
): StreamSession | null {
  if (!current && event.type !== 'start') return current
  switch (event.type) {
    case 'start':
      return {
        streamId: event.streamId,
        status: 'streaming',
        content: '',
        finishReason: null,
        promptTokens: null,
        completionTokens: null,
        errorMessage: null,
        retryable: false,
      }
    case 'chunk': {
      if (!current || event.chunk.streamId !== current.streamId) return current
      const next: StreamSession = {
        ...current,
        content: current.content + event.chunk.delta,
        finishReason: event.chunk.finishReason ?? current.finishReason,
      }
      if (event.chunk.promptTokens !== null) next.promptTokens = event.chunk.promptTokens
      if (event.chunk.completionTokens !== null) next.completionTokens = event.chunk.completionTokens
      if (event.chunk.done) next.status = 'completed'
      return next
    }
    case 'done':
      if (!current || event.terminal.streamId !== current.streamId) return current
      return current.status === 'cancelled' || current.status === 'failed'
        ? current
        : { ...current, status: 'completed' }
    case 'cancelled':
      if (!current || event.terminal.streamId !== current.streamId) return current
      return { ...current, status: 'cancelled' }
    case 'error':
      if (!current || event.error.streamId !== current.streamId) return current
      return {
        ...current,
        status: 'failed',
        errorMessage: event.error.message,
        retryable: event.error.retryable,
      }
    default:
      return current
  }
}

/**
 * Decide whether an error from `ai_chat` (non-streaming fallback) is transient
 * enough to be worth retrying. Mirrors the Rust `is_retryable` predicate.
 */
export function isRetryableErrorMessage(message: string): boolean {
  const lower = message.toLowerCase()
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('connection')) return true
  const match = lower.match(/http\s+(\d{3})/)
  if (!match) return false
  const status = Number(match[1])
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

export interface RunStreamOptions {
  onChunk?: (session: StreamSession) => void
  signal?: AbortSignal
  /** Hook invoked right after the stream id is acquired but before the first chunk. */
  onStart?: (streamId: string) => void
  /** Non-streaming fallback used if the runtime does not expose `ai_chat_stream`. */
  fallback?: (providerId: string, request: ChatRequest) => Promise<ChatResponse>
}

export interface RunStreamResult {
  content: string
  promptTokens: number | null
  completionTokens: number | null
}

/**
 * Run a streaming chat completion against the configured provider. Falls back
 * to the synchronous `ai_chat` command when the runtime lacks stream support
 * (e.g. plain web preview mode). Cancellation is propagated to both the Rust
 * stream registry and to the caller via `AbortSignal`.
 */
export async function runChatStream(
  providerId: string,
  request: ChatRequest,
  options: RunStreamOptions = {},
): Promise<RunStreamResult> {
  const fallback = options.fallback ?? aiChat
  if (typeof window === 'undefined' || typeof (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === 'undefined') {
    const response = await fallback(providerId, request)
    return {
      content: response.content,
      promptTokens: response.promptTokens ?? null,
      completionTokens: response.completionTokens ?? null,
    }
  }

  const streamId = await aiChatStream(providerId, request)
  options.onStart?.(streamId)

  const tauri = await import('@tauri-apps/api/event')
  const chunks: StreamChunkEvent[] = []
  const terminals: Array<StreamTerminalEvent | StreamErrorEvent> = []

  const unlistenChunk = await tauri.listen<StreamChunkEvent>('ai://stream-chunk', event => {
    if (event.payload.streamId !== streamId) return
    chunks.push(event.payload)
  })
  const unlistenDone = await tauri.listen<StreamTerminalEvent>('ai://stream-done', event => {
    if (event.payload.streamId !== streamId) return
    terminals.push(event.payload)
  })
  const unlistenCancelled = await tauri.listen<StreamTerminalEvent>('ai://stream-cancelled', event => {
    if (event.payload.streamId !== streamId) return
    terminals.push(event.payload)
  })
  const unlistenError = await tauri.listen<StreamErrorEvent>('ai://stream-error', event => {
    if (event.payload.streamId !== streamId) return
    terminals.push(event.payload)
  })

  let session: StreamSession | null = reduceStreamSession(null, { type: 'start', streamId })
  let aborted = false
  const abortHandler = () => {
    aborted = true
    void aiChatCancel(streamId)
  }
  options.signal?.addEventListener('abort', abortHandler)

  try {
    while (true) {
      if (aborted) {
        session = reduceStreamSession(session, { type: 'cancelled', terminal: { streamId } })
        break
      }
      const nextChunk = chunks.shift()
      if (nextChunk) {
        session = reduceStreamSession(session, { type: 'chunk', chunk: nextChunk })
        if (session) options.onChunk?.(session)
        if (nextChunk.done) break
        continue
      }
      const nextTerminal = terminals.shift()
      if (nextTerminal) {
        if ('message' in nextTerminal) {
          session = reduceStreamSession(session, { type: 'error', error: nextTerminal })
        } else {
          session = reduceStreamSession(session, { type: 'done', terminal: nextTerminal })
        }
        break
      }
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  } finally {
    options.signal?.removeEventListener('abort', abortHandler)
    void unlistenChunk()
    void unlistenDone()
    void unlistenCancelled()
    void unlistenError()
  }

  if (!session) throw new Error('stream session lost')
  if (session.status === 'failed') {
    throw new Error(session.errorMessage ?? 'AI request failed')
  }
  if (session.status === 'cancelled') {
    throw new Error('AI request cancelled')
  }
  return {
    content: session.content,
    promptTokens: session.promptTokens,
    completionTokens: session.completionTokens,
  }
}