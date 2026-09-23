/**
 * Pure history dedupe logic shared by BrowserPage (write side) and
 * LibraryPage (read side). Dedupes the most-recent URL — re-visiting the same
 * page updates its title and timestamp instead of growing the list. The full
 * history is retained by default; callers may still provide an explicit cap.
 */
export interface HistoryEntry {
  url: string
  title: string
  visitedAt: number
}

export const HISTORY_CHANGE_EVENT = 'arcadia-history-change'

export function dedupeHistory(entries: HistoryEntry[], next: HistoryEntry, limit = Number.POSITIVE_INFINITY): HistoryEntry[] {
  if (!next.url) return entries
  if (entries.length > 0 && entries[0].url === next.url) {
    return [{ ...next }, ...entries.slice(1)].slice(0, limit)
  }
  return [{ ...next }, ...entries].slice(0, limit)
}

export function parseHistory(raw: string | null | undefined): HistoryEntry[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    return value
      .filter((entry): entry is HistoryEntry =>
        !!entry && typeof entry === 'object'
        && typeof (entry as HistoryEntry).url === 'string'
        && typeof (entry as HistoryEntry).title === 'string'
        && typeof (entry as HistoryEntry).visitedAt === 'number',
      )
      .sort((a, b) => b.visitedAt - a.visitedAt)
  } catch {
    return []
  }
}
