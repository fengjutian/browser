import { useEffect, useState } from 'react'

/**
 * Schedule a single delayed invocation of `set(value)`. Returns a cancel
 * function that clears the pending timer. Used by `useDebouncedValue` and
 * exposed directly so it can be unit-tested without rendering a component.
 */
export function debounce<T>(value: T, delayMs: number, set: (next: T) => void): () => void {
  const timer = setTimeout(() => set(value), delayMs)
  return () => clearTimeout(timer)
}

/**
 * React hook returning `value` only after it has stayed stable for `delayMs`
 * milliseconds. Re-rendering with a new value resets the timer; unmounting
 * cancels the pending update.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => debounce(value, delayMs, setDebounced), [value, delayMs])
  return debounced
}