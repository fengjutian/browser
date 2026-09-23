import { describe, expect, it } from 'vitest'
import type { BookmarkRecord } from '../../services/bookmarks'
import { searchBookmarks } from './bookmarkSearchIndex'

function bm(partial: Partial<BookmarkRecord>): BookmarkRecord {
  return {
    id: partial.id ?? 'bm',
    url: partial.url ?? 'https://example.com',
    title: partial.title ?? 'Example',
    favicon: partial.favicon ?? null,
    folder: partial.folder ?? '',
    note: partial.note ?? '',
    position: partial.position ?? 0,
    createdAt: partial.createdAt ?? '2024-01-01T00:00:00Z',
    updatedAt: partial.updatedAt ?? '2024-01-01T00:00:00Z',
  }
}

describe('searchBookmarks', () => {
  it('returns all bookmarks in original order when query is empty', () => {
    const list = [bm({ id: 'a' }), bm({ id: 'b', folder: 'work' })]
    const out = searchBookmarks('', list)
    expect(out.map(r => r.id)).toEqual(['a', 'b'])
    expect(out[1].score).toBeGreaterThanOrEqual(out[0].score)
  })

  it('matches titles and returns highlight spans', () => {
    const list = [bm({ id: 'docs', title: 'API Documentation' })]
    const out = searchBookmarks('api', list)
    expect(out.length).toBeGreaterThan(0)
    expect(out[0].titleHighlights.length).toBeGreaterThan(0)
  })

  it('matches the URL when title does not contain the query', () => {
    const list = [bm({ id: 'home', title: 'Welcome', url: 'https://example.com/help' })]
    const out = searchBookmarks('help', list)
    expect(out[0].id).toBe('home')
    expect(out[0].urlHighlights.length).toBeGreaterThan(0)
  })

  it('matches note text with a smaller weight than title', () => {
    const list = [
      bm({ id: 'note', title: 'Random title', url: 'https://nope.com', note: 'my favourite reading list' }),
      bm({ id: 'direct', title: 'Reading List Hub', url: 'https://reading.com' }),
    ]
    const out = searchBookmarks('reading', list)
    expect(out[0].id).toBe('direct')
  })

  it('respects the limit option', () => {
    const list = Array.from({ length: 30 }, (_, i) => bm({ id: `b${i}`, title: 'Same' }))
    expect(searchBookmarks('same', list, { limit: 5 }).length).toBe(5)
  })
})
describe('debug', () => {
  it('returns a non-empty result for an obvious query', () => {
    const list = [bm({ id: 'docs', title: 'API Documentation', url: 'https://example.com' })]
    const out = searchBookmarks('docs', list)
    // eslint-disable-next-line no-console
    console.log('DEBUG searchBookmarks out', JSON.stringify(out))
    expect(out.length).toBeGreaterThan(0)
  })
})
