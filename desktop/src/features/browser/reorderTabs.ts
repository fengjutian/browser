/**
 * Move the item at `from` to position `to`. Returns the same array reference
 * when the move is a no-op so React `useState` bails out of re-rendering.
 */
export function reorderTabs<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to) return items.slice()
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return items.slice()
  const next = items.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}