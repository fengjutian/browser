import { describe, expect, it } from 'vitest'
import { buildAddressSuggestions } from './addressSuggestions'
import type { HistoryEntry } from '../history/dedupeHistory'

const row = (url: string, title: string, visitedAt = 0): HistoryEntry => ({ url, title, visitedAt })

describe('buildAddressSuggestions', () => {
  it('returns up to limit entries without a query', () => {
    const history = Array.from({ length: 12 }, (_, i) => row(`https://example.com/${i}`, `Example ${i}`))
    const result = buildAddressSuggestions('', history, item => item.url, 8)
    expect(result).toHaveLength(8)
    expect(result[0].value).toBe('https://example.com/0')
  })

  it('matches query against title and url case-insensitively', () => {
    const history = [
      row('https://github.com/foo', 'GitHub Foo'),
      row('https://example.com', 'Example'),
      row('https://github.com/bar', 'GitHub Bar'),
    ]
    const result = buildAddressSuggestions('GITHUB', history, item => item.title)
    expect(result.map(item => item.value)).toEqual(['https://github.com/foo', 'https://github.com/bar'])
  })

  it('matches by url even when title does not contain the query', () => {
    const history = [row('https://docs.arcadia.dev/browser', 'Docs')]
    const result = buildAddressSuggestions('arcadia', history, item => item.title)
    expect(result).toHaveLength(1)
  })

  it('trims the query and ignores whitespace', () => {
    const history = [row('https://example.com', 'Example')]
    expect(buildAddressSuggestions('   example   ', history, item => item.url)[0].value).toBe('https://example.com')
  })

  it('returns an empty list when no entries match', () => {
    const history = [row('https://example.com', 'Example')]
    expect(buildAddressSuggestions('zzz', history, item => item.url)).toEqual([])
  })

  it('respects a custom limit', () => {
    const history = Array.from({ length: 5 }, (_, i) => row(`https://e.com/${i}`, `${i}`))
    expect(buildAddressSuggestions('', history, item => item.url, 3)).toHaveLength(3)
  })
})