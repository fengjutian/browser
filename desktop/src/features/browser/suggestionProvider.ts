/**
 * Address-bar suggestion provider. Merges four sources — open tabs, history,
 * bookmarks, and the implicit "search" fallback — and ranks them by a small
 * composite score:
 *
 *   - tabMatch   exact title or url match on an open tab  → +1000
 *   - exactUrl   exact URL hit in history                → +600
 *   - prefixMatch URL prefix hit                         → +200
 *   - titleMatch title substring hit                     → +100
 *   - recentBonus visited within the last hour          → +50
 *
 * The merge is pure: callers pass the source arrays and a `now` value.
 * Duplicates collapse by `url` (the open-tab entry wins because its score
 * is highest). The render function is left to the consumer so this module
 * stays UI-agnostic.
 */
import type { HistoryEntry } from '../history/dedupeHistory'

export type SuggestionSource = 'open-tab' | 'history' | 'bookmark' | 'search'

export interface SuggestionItem {
  url: string
  title: string
  source: SuggestionSource
  /** Final ranking score; higher ranks first. */
  score: number
  /** Used for the "search" fallback; never present for tab/history rows. */
  searchTemplate?: string
}

export interface SuggestionInputs {
  query: string
  openTabs: { url: string; title: string }[]
  history: HistoryEntry[]
  bookmarks: { url: string; title: string }[]
  searchTemplate: string
  now?: number
}

const TITLE_MAX = 120

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (typeof value === 'object' && 'value' in value && typeof value.value === 'string') return value.value
  return String(value)
}

function trimTitle(value: unknown): string {
  const text = asText(value)
  if (!text) return ''
  if (text.length <= TITLE_MAX) return text
  return `${text.slice(0, TITLE_MAX - 1)}…`
}

function norm(value: unknown): string {
  return asText(value).trim().toLocaleLowerCase()
}

function scoreUrl(query: string, url: string, now: number, visitedAt?: number): number {
  if (!query) return 0
  const q = norm(query)
  const u = norm(url)
  if (u === q) return 600
  if (u.startsWith(q)) return 200
  if (u.includes(q)) return 80
  if (visitedAt && now - visitedAt < 60 * 60 * 1000) return 50
  return 0
}

function scoreTitle(query: string, title: string): number {
  const q = norm(query)
  if (!q) return 0
  const t = norm(title)
  if (!t) return 0
  if (t === q) return 300
  if (t.startsWith(q)) return 150
  if (t.includes(q)) return 100
  return 0
}

export function buildSuggestions(input: SuggestionInputs): SuggestionItem[] {
  const { query, openTabs, history, bookmarks, searchTemplate } = input
  const now = input.now ?? Date.now()
  const q = norm(query)
  const items = new Map<string, SuggestionItem>()

  const upsert = (url: unknown, title: unknown, source: SuggestionSource, score: number, searchTemplate?: string) => {
    const safeUrl = asText(url)
    if (score <= 0 || !safeUrl) return
    const existing = items.get(safeUrl)
    if (!existing || existing.score < score) {
      items.set(safeUrl, { url: safeUrl, title: trimTitle(title), source, score, searchTemplate })
    }
  }

  for (const tab of openTabs) {
    const tabScore = 1000 + scoreUrl(query, tab.url, now) + scoreTitle(query, tab.title)
    if (tabScore <= 1000) continue
    upsert(tab.url, tab.title, 'open-tab', tabScore)
  }
  for (const entry of history) {
    upsert(entry.url, entry.title, 'history', scoreUrl(query, entry.url, now, entry.visitedAt) + scoreTitle(query, entry.title))
  }
  for (const bookmark of bookmarks) {
    upsert(bookmark.url, bookmark.title, 'bookmark', scoreUrl(query, bookmark.url, now) + scoreTitle(query, bookmark.title))
  }
  if (q) {
    items.set(`__search__:${q}`, {
      url: asText(searchTemplate).replace('{query}', encodeURIComponent(q)),
      title: `搜索 "${q}"`,
      source: 'search',
      score: 10,
      searchTemplate: searchTemplate,
    })
  }

  const list = Array.from(items.values())
  list.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.url.localeCompare(b.url)
  })
  return list
}

/**
 * Reduce the suggestion list to the top `limit` entries. Keeps the
 * "search" fallback at the bottom so it never crowds out real URLs.
 */
export function trimSuggestions(items: SuggestionItem[], limit = 8): SuggestionItem[] {
  if (items.length <= limit) return items
  const search = items.filter(item => item.source === 'search')
  const nonSearch = items.filter(item => item.source !== 'search').slice(0, Math.max(0, limit - search.length))
  return [...nonSearch, ...search]
}
