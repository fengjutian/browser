import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debounce } from './useDebouncedValue'

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not invoke the setter before the delay elapses', () => {
    const set = vi.fn()
    debounce('value', 250, set)
    expect(set).not.toHaveBeenCalled()
    vi.advanceTimersByTime(249)
    expect(set).not.toHaveBeenCalled()
  })

  it('invokes the setter exactly once after the delay', () => {
    const set = vi.fn()
    debounce('value', 250, set)
    vi.advanceTimersByTime(250)
    expect(set).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith('value')
  })

  it('returned cancel function clears the pending timer', () => {
    const set = vi.fn()
    const cancel = debounce('value', 250, set)
    cancel()
    vi.advanceTimersByTime(1_000)
    expect(set).not.toHaveBeenCalled()
  })

  it('honors a custom delay', () => {
    const set = vi.fn()
    debounce('value', 750, set)
    vi.advanceTimersByTime(250)
    expect(set).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(set).toHaveBeenCalledWith('value')
  })

  it('keeps only the latest value when invoked repeatedly', () => {
    const set = vi.fn()
    const cancelA = debounce('first', 250, set)
    cancelA()
    const cancelB = debounce('second', 250, set)
    cancelB()
    const cancelC = debounce('third', 250, set)
    vi.advanceTimersByTime(250)
    expect(set).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith('third')
  })
})