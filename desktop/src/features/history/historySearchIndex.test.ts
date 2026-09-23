import { describe, expect, it } from 'vitest'
import { dedupeHistory, limitHistory, removeHistoryEntry } from './dedupeHistory'
import { searchHistory } from './historySearchIndex'

const NOW = 1_700_000_000_000

function entry(url: string, title: string, visitedAt: number) {
  return { url, title, visitedAt }
}

describe('removeHistoryEntry', () => {
  it('drops every entry whose URL matches and reports whether anything changed', () => {
    const list = [entry('https://a', 'A', 1), entry('https://b', 'B', 2), entry('https://a', 'A again', 4)]
    const result = removeHistoryEntry(list, 'https://a')
    expect(result.remaining.map(e => e.url)).toEqual(['https://b'])
    expect(result.removed).toBe(true)
  })

  it('returns the same list when nothing matches', () => {
    const list = [entry('https://a', 'A', 1)]
    const result = removeHistoryEntry(list, 'https://missing')
    expect(result.remaining).toEqual(list)
    expect(result.removed).toBe(false)
  })
})

describe('limitHistory', () => {
  it('keeps the first N entries and discards the rest', () => {
    const list = Array.from({ length: 10 }, (_, i) => entry(`https://${i}`, `t${i}`, i))
    const result = limitHistory(list, 3)
    expect(result.map(e => e.url)).toEqual(['https://0', 'https://1', 'https://2'])
  })

  it('returns input untouched when the cap is invalid', () => {
    const list = [entry('https://a', 'A', 1)]
    expect(limitHistory(list, 0)).toEqual(list)
    expect(limitHistory(list, -1)).toEqual(list)
    expect(limitHistory(list, Number.NaN)).toEqual(list)
  })
})

describe('searchHistory', () => {
  const recent = entry('https://docs.example.com/api', 'API docs', NOW - 5 * 60_000)
  const older = entry('https://blog.example.com', 'Random blog', NOW - 24 * 3600_000)
  const entries = [recent, older]

  it('returns recent entries in original order when query is empty', () => {
    const out = searchHistory('', entries)
    expect(out.map(r => r.url)).toEqual(entries.map(e => e.url))
  })

  it('matches by title with title-weighted scoring', () => {
    const out = searchHistory('api', entries)
    expect(out[0].url).toBe(recent.url)
    expect(out[0].titleHighlights.length).toBeGreaterThan(0)
  })

  it('falls back to URL matches', () => {
    const out = searchHistory('blog.example', entries)
    expect(out[0].url).toBe(older.url)
  })

  it('respects the limit option', () => {
    const list = Array.from({ length: 50 }, (_, i) => entry(`https://x${i}.com`, `x${i}`, NOW - i))
    expect(searchHistory('x', list, { limit: 7 }).length).toBe(7)
  })

  it('boosts fresh entries on equal content score', () => {
    const out = searchHistory('docs', entries)
    // 'API docs' (title) hits + recency boost lifts the recent entry.
    expect(out[0].url).toBe(recent.url)
  })
})

describe('dedupeHistory still works alongside the new helpers', () => {
  it('preserves insertion order after dedupe', () => {
    const list = [entry('https://a', 'A', 2), entry('https://b', 'B', 1)]
    const after = dedupeHistory(list, entry('https://a', 'A v2', 3))
    expect(after.map(e => e.visitedAt)).toEqual([3, 1])
  })
})