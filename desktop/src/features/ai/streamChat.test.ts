import { describe, expect, it } from 'vitest'
import {
  isRetryableErrorMessage,
  reduceStreamSession,
  type StreamSession,
} from './streamChat'

const baseSession: StreamSession = {
  streamId: 'ai-test-1',
  status: 'streaming',
  content: '',
  finishReason: null,
  promptTokens: null,
  completionTokens: null,
  errorMessage: null,
  retryable: false,
}

describe('reduceStreamSession', () => {
  it('initialises a session on start', () => {
    const next = reduceStreamSession(null, { type: 'start', streamId: 'ai-x' })
    expect(next?.streamId).toBe('ai-x')
    expect(next?.status).toBe('streaming')
  })

  it('appends delta text and tracks finish reason', () => {
    const started = reduceStreamSession(null, { type: 'start', streamId: 'ai-x' })
    const afterDelta = reduceStreamSession(started, {
      type: 'chunk',
      chunk: { streamId: 'ai-x', delta: 'Hel', finishReason: null, done: false, promptTokens: null, completionTokens: null },
    })
    const afterDelta2 = reduceStreamSession(afterDelta, {
      type: 'chunk',
      chunk: { streamId: 'ai-x', delta: 'lo', finishReason: 'stop', done: false, promptTokens: null, completionTokens: null },
    })
    expect(afterDelta2?.content).toBe('Hello')
    expect(afterDelta2?.finishReason).toBe('stop')
    expect(afterDelta2?.status).toBe('streaming')
  })

  it('marks completed when a terminal chunk arrives', () => {
    const started = reduceStreamSession(null, { type: 'start', streamId: 'ai-x' })
    const after = reduceStreamSession(started, {
      type: 'chunk',
      chunk: { streamId: 'ai-x', delta: '', finishReason: 'stop', done: true, promptTokens: 10, completionTokens: 5 },
    })
    expect(after?.status).toBe('completed')
    expect(after?.promptTokens).toBe(10)
    expect(after?.completionTokens).toBe(5)
  })

  it('ignores chunks for a different stream id', () => {
    const started = reduceStreamSession(null, { type: 'start', streamId: 'ai-x' })
    const after = reduceStreamSession(started, {
      type: 'chunk',
      chunk: { streamId: 'ai-other', delta: 'noise', finishReason: null, done: false, promptTokens: null, completionTokens: null },
    })
    expect(after?.content).toBe('')
  })

  it('transitions to cancelled on cancel event', () => {
    const started = reduceStreamSession(baseSession, { type: 'start', streamId: baseSession.streamId })
    const cancelled = reduceStreamSession(started, { type: 'cancelled', terminal: { streamId: baseSession.streamId } })
    expect(cancelled?.status).toBe('cancelled')
  })

  it('captures error message and retryable flag', () => {
    const started = reduceStreamSession(baseSession, { type: 'start', streamId: baseSession.streamId })
    const failed = reduceStreamSession(started, {
      type: 'error',
      error: { streamId: baseSession.streamId, message: 'http 503', retryable: true },
    })
    expect(failed?.status).toBe('failed')
    expect(failed?.errorMessage).toBe('http 503')
    expect(failed?.retryable).toBe(true)
  })
})

describe('isRetryableErrorMessage', () => {
  it.each([
    ['http 500', true],
    ['http 502', true],
    ['http 503', true],
    ['http 504', true],
    ['http 429', true],
    ['http 408', true],
    ['http 400', false],
    ['http 401', false],
    ['http 404', false],
    ['connection refused', true],
    ['request timeout', true],
    ['empty assistant content', false],
    ['missing api key', false],
  ])('classifies %s as %s', (input, expected) => {
    expect(isRetryableErrorMessage(input)).toBe(expected)
  })
})