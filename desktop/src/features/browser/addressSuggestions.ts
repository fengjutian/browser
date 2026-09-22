import type { ReactNode } from 'react'
import type { HistoryEntry } from '../history/dedupeHistory'

/**
 * One row in the address-bar AutoComplete dropdown. `value` is what we navigate
 * to; `label` is the rendered node. Keeping the row definition colocated with
 * the matcher avoids leaks between the suggestion UI and the navigation logic.
 */
export interface AddressSuggestion {
  value: string
  label: ReactNode
}

export const ADDRESS_SUGGESTION_LIMIT = 8

const matches = (query: string, item: HistoryEntry): boolean => {
  if (!query) return true
  return item.url.toLocaleLowerCase().includes(query) || item.title.toLocaleLowerCase().includes(query)
}

/**
 * Pure helper extracted from BrowserPage so the autocomplete behaviour can be
 * unit tested without rendering React. The returned rows mirror what the
 * address bar used to inline-render: bold title (or url fallback) plus the url
 * in muted text. We don't strip duplicates here because history is already
 * deduped on write by dedupeHistory.
 */
export function buildAddressSuggestions(
  query: string,
  history: readonly HistoryEntry[],
  renderLabel: (item: HistoryEntry) => ReactNode,
  limit = ADDRESS_SUGGESTION_LIMIT,
): AddressSuggestion[] {
  const needle = query.trim().toLocaleLowerCase()
  return history
    .filter(item => matches(needle, item))
    .slice(0, limit)
    .map(item => ({ value: item.url, label: renderLabel(item) }))
}