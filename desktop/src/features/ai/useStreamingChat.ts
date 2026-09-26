import { useCallback, useEffect, useRef, useState } from 'react'
import { isRetryableErrorMessage, runChatStream, type StreamSession } from './streamChat'
import type { ChatRequest } from '../../types'

export type StreamingChatStatus = 'idle' | 'streaming' | 'completed' | 'cancelled' | 'failed'

export interface UseStreamingChatResult {
  status: StreamingChatStatus
  content: string
  errorMessage: string | null
  retryable: boolean
  attempts: number
  start: (providerId: string, request: ChatRequest) => Promise<{ content: string; promptTokens: number | null; completionTokens: number | null }>
  cancel: () => void
  reset: () => void
}

export interface UseStreamingChatOptions {
  /** Maximum number of attempts before giving up. Defaults to 2 (one retry). */
  maxAttempts?: number
  /** Delay between retries, in milliseconds. Defaults to 600. */
  retryDelayMs?: number
  /** Called on every chunk so the consumer can react before the promise resolves. */
  onChunk?: (session: StreamSession) => void
}

const DEFAULT_MAX_ATTEMPTS = 2
const DEFAULT_RETRY_DELAY_MS = 600

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * React hook that wraps `runChatStream` with cancellation, transient-error
 * retries and a single promise the caller can `await`. The internal
 * `AbortController` lets `cancel()` tear down both the Rust registry and any
 * retry wait without leaking listeners.
 */
export function useStreamingChat(options: UseStreamingChatOptions = {}): UseStreamingChatResult {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const [status, setStatus] = useState<StreamingChatStatus>('idle')
  const [content, setContent] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [retryable, setRetryable] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const chunkHandlerRef = useRef<typeof options.onChunk>(options.onChunk)

  useEffect(() => {
    chunkHandlerRef.current = options.onChunk
  }, [options.onChunk])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStatus('idle')
    setContent('')
    setErrorMessage(null)
    setRetryable(false)
    setAttempts(0)
  }, [])

  const start = useCallback(
    async (providerId: string, request: ChatRequest) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setStatus('streaming')
      setContent('')
      setErrorMessage(null)
      setRetryable(false)

      let lastError: Error | null = null
      let attempt = 0
      while (attempt < maxAttempts) {
        attempt += 1
        setAttempts(attempt)
        try {
          const result = await runChatStream(providerId, request, {
            signal: controller.signal,
            onChunk: session => {
              setContent(session.content)
              chunkHandlerRef.current?.(session)
            },
          })
          if (controller.signal.aborted) {
            setStatus('cancelled')
            throw new Error('cancelled')
          }
          setStatus('completed')
          setContent(result.content)
          abortRef.current = null
          return result
        } catch (error) {
          if (controller.signal.aborted) {
            setStatus('cancelled')
            throw new Error('cancelled')
          }
          const message = error instanceof Error ? error.message : 'AI request failed'
          lastError = error instanceof Error ? error : new Error(message)
          const retry = attempt < maxAttempts && isRetryableErrorMessage(message)
          setRetryable(retry)
          if (!retry) break
          await wait(retryDelayMs)
          if (controller.signal.aborted) break
        }
      }
      const message = lastError?.message ?? 'AI request failed'
      setErrorMessage(message)
      setStatus('failed')
      abortRef.current = null
      throw lastError ?? new Error(message)
    },
    [maxAttempts, retryDelayMs],
  )

  useEffect(() => () => abortRef.current?.abort(), [])

  return { status, content, errorMessage, retryable, attempts, start, cancel, reset }
}