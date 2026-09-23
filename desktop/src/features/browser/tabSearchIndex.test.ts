import { describe, expect, it } from 'vitest'
import type { BrowserTab } from '../../types'
import { searchTabs } from './tabSearchIndex'

function tab(partial: Partial<BrowserTab>): BrowserTab {
  return {
    id: partial.id ?? 'tab',
    url: partial.url ?? 'about:blank',
    title: partial.title ?? '',
    loading: false,
    active: false,
    pinned: partial.pinned ?? false,
    ...partial,
  } as BrowserTab
}

describe('searchTabs', () => {
  it('returns every tab in original order when query is empty', () => {
    const tabs = [tab({ id: 'a', title: 'A' }), tab({ id: 'b', title: 'B' })]
    const out = searchTabs('', tabs)
    expect(out.map(r => r.id)).toEqual(['a', 'b'])
  })

  it('matches by title and ranks title higher than url', () => {
    const tabs = [
      tab({ id: 'doc', title: 'Documentation', url: 'https://example.com' }),
      tab({ id: 'page', title: 'Home', url: 'https://docs.example.com/path' }),
    ]
    const out = searchTabs('doc', tabs)
    expect(out[0].id).toBe('doc')
    expect(out[0].titleHighlights.length).toBeGreaterThan(0)
  })

  it('falls back to url matches when title does not contain the query', () => {
    const tabs = [
      tab({ id: 'home', title: 'Welcome', url: 'https://example.com/home' }),
      tab({ id: 'docs', title: 'Docs', url: 'https://docs.example.com/page' }),
    ]
    const out = searchTabs('docs.example', tabs)
    expect(out[0].id).toBe('docs')
    expect(out[0].urlHighlights.length).toBeGreaterThan(0)
  })

  it('boosts the active tab when scores tie', () => {
    const tabs = [
      tab({ id: 'a', title: 'Example' }),
      tab({ id: 'b', title: 'Example', active: true }),
    ]
    const out = searchTabs('example', tabs)
    expect(out[0].id).toBe('b')
  })

  it('boosts pinned tabs above non-pinned at equal score', () => {
    const tabs = [
      tab({ id: 'p', title: 'Note', pinned: true }),
      tab({ id: 'n', title: 'Note' }),
    ]
    const out = searchTabs('note', tabs)
    expect(out[0].id).toBe('p')
  })

  it('returns an empty list when nothing matches', () => {
    const tabs = [tab({ id: 'a', title: 'Hello' })]
    const out = searchTabs('zzzzz', tabs)
    expect(out).toEqual([])
  })

  it('respects the limit option', () => {
    const tabs = Array.from({ length: 25 }, (_, i) => tab({ id: `t${i}`, title: 'Tab' }))
    expect(searchTabs('', tabs, { limit: 5 }).length).toBe(5)
  })

  it('subsequence match ignores intermediate characters', () => {
    const tabs = [tab({ id: 'a', title: 'GraphQL Documentation' })]
    const out = searchTabs('gql', tabs)
    expect(out[0].id).toBe('a')
  })
})