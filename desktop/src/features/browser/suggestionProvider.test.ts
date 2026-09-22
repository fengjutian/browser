import { describe, expect, it } from 'vitest'
import { buildSuggestions, trimSuggestions } from './suggestionProvider'
import type { HistoryEntry } from '../history/dedupeHistory'

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0)
const recent = (offset: number): number => NOW - offset

const template = 'https://duckduckgo.com/?q={query}'

describe('buildSuggestions', () => {
  it('returns no items when the query is empty', () => {
    const items = buildSuggestions({
      query: '',
      openTabs: [{ url: 'https://example.com', title: 'Example' }],
      history: [],
      bookmarks: [],
      searchTemplate: template,
      now: NOW,
    })
    expect(items).toHaveLength(0)
  })

  it('ranks open tabs above history when both match', () => {
    const history: HistoryEntry[] = [{ url: 'https://github.com/bar', title: 'GitHub Bar', visitedAt: NOW }]
    const items = buildSuggestions({
      query: 'github',
      openTabs: [{ url: 'https://github.com/foo', title: 'GitHub Foo' }],
      history,
      bookmarks: [],
      searchTemplate: template,
      now: NOW,
    })
    expect(items[0].source).toBe('open-tab')
    expect(items[1].source).toBe('history')
  })

  it('dedupes by url — open tab wins', () => {
    const items = buildSuggestions({
      query: 'github',
      openTabs: [{ url: 'https://github.com/foo', title: 'GitHub Foo' }],
      history: [{ url: 'https://github.com/foo', title: 'GitHub Foo Older', visitedAt: NOW }],
      bookmarks: [{ url: 'https://github.com/foo', title: 'GitHub Foo Starred' }],
      searchTemplate: template,
      now: NOW,
    })
    expect(items).toHaveLength(2) // open tab + search fallback
    expect(items.filter(item => item.source !== 'search')).toHaveLength(1)
  })

  it('prefers recent history visits', () => {
    const history: HistoryEntry[] = [
      { url: 'https://example.com/a', title: 'A', visitedAt: NOW - 30 * 60 * 1000 }, // 30 min ago
      { url: 'https://example.com/b', title: 'B', visitedAt: NOW - 5 * 24 * 60 * 60 * 1000 }, // 5 days ago
    ]
    const items = buildSuggestions({
      query: 'example',
      openTabs: [],
      history,
      bookmarks: [],
      searchTemplate: template,
      now: NOW,
    })
    const nonSearch = items.filter(item => item.source === 'history')
    expect(nonSearch[0].url).toBe('https://example.com/a')
    expect(nonSearch[1].url).toBe('https://example.com/b')
  })

  it('always appends the search fallback', () => {
    const items = buildSuggestions({
      query: 'rust',
      openTabs: [],
      history: [],
      bookmarks: [],
      searchTemplate: template,
      now: NOW,
    })
    expect(items.at(-1)?.source).toBe('search')
    expect(items.at(-1)?.url).toBe('https://duckduckgo.com/?q=rust')
  })

  it('trims the title so labels stay readable', () => {
    const longTitle = 'A'.repeat(200)
    const items = buildSuggestions({
      query: 'github',
      openTabs: [{ url: 'https://github.com/foo', title: longTitle }],
      history: [],
      bookmarks: [],
      searchTemplate: template,
      now: NOW,
    })
    expect(items[0].title.length).toBeLessThanOrEqual(120)
  })
})

describe('trimSuggestions', () => {
  it('caps the result list while preserving the search fallback', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      url: `https://example.com/${i}`,
      title: `${i}`,
      source: 'history' as const,
      score: 100 - i,
    }))
    const search = {
      url: 'https://duckduckgo.com/?q=test',
      title: 'search',
      source: 'search' as const,
      score: 10,
    }
    const result = trimSuggestions([...items, search], 5)
    expect(result).toHaveLength(5)
    expect(result.at(-1)?.source).toBe('search')
  })
})