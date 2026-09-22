import { describe, expect, it } from 'vitest'
import { dedupeHistory, parseHistory, type HistoryEntry } from './dedupeHistory'

const entry = (url: string, title = url, visitedAt = 0): HistoryEntry => ({ url, title, visitedAt })

describe('dedupeHistory', () => {
  it('appends a new entry to the front when URL differs', () => {
    const result = dedupeHistory([entry('https://a/'), entry('https://b/')], entry('https://c/', 'C', 5))
    expect(result.map(e => e.url)).toEqual(['https://c/', 'https://a/', 'https://b/'])
  })

  it('updates the most-recent entry instead of duplicating when URL matches', () => {
    const result = dedupeHistory([entry('https://a/', 'Old A'), entry('https://b/')], entry('https://a/', 'New A', 9))
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ url: 'https://a/', title: 'New A', visitedAt: 9 })
    expect(result[1].url).toBe('https://b/')
  })

  it('drops empty-URL entries (no entry, no append)', () => {
    const result = dedupeHistory([entry('https://a/')], entry('', '', 5))
    expect(result).toEqual([entry('https://a/')])
  })

  it('caps the list at the provided limit', () => {
    const seed = Array.from({ length: 50 }, (_, i) => entry(`https://x/${i}/`))
    const result = dedupeHistory(seed, entry('https://new/'), 50)
    expect(result).toHaveLength(50)
    expect(result[0].url).toBe('https://new/')
  })

  it('uses default limit of 50 when omitted', () => {
    const seed = Array.from({ length: 49 }, (_, i) => entry(`https://x/${i}/`))
    const result = dedupeHistory(seed, entry('https://new/'))
    expect(result).toHaveLength(50)
  })
})

describe('parseHistory', () => {
  it('returns [] for null / empty input', () => {
    expect(parseHistory(null)).toEqual([])
    expect(parseHistory(undefined)).toEqual([])
    expect(parseHistory('')).toEqual([])
  })

  it('returns [] for malformed JSON', () => {
    expect(parseHistory('not json')).toEqual([])
    expect(parseHistory('{not array}')).toEqual([])
  })

  it('drops entries with wrong shape', () => {
    const raw = JSON.stringify([
      { url: 'https://a/', title: 'A', visitedAt: 1 },
      { url: 42, title: 'X', visitedAt: 1 },
      null,
      'string',
    ])
    expect(parseHistory(raw)).toEqual([{ url: 'https://a/', title: 'A', visitedAt: 1 }])
  })

  it('caps parsed list at the default limit', () => {
    const seed = Array.from({ length: 80 }, (_, i) => entry(`https://x/${i}/`))
    expect(parseHistory(JSON.stringify(seed))).toHaveLength(50)
  })
})