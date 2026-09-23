import { describe, expect, it } from 'vitest'
import type { BrowserTab } from '../../types'
import { groupTabsByOrigin, idsToCloseForSameDomain, tabOrigin } from './tabGrouping'

function tab(partial: Partial<BrowserTab>): BrowserTab {
  return {
    id: partial.id ?? 'tab',
    url: partial.url ?? 'about:blank',
    title: partial.title ?? 'tab',
    loading: false,
    active: false,
    pinned: partial.pinned ?? false,
    ...partial,
  } as BrowserTab
}

describe('tabOrigin', () => {
  it('returns the hostname for http(s)', () => {
    expect(tabOrigin('https://docs.example.com/path?q=1')).toBe('docs.example.com')
    expect(tabOrigin('http://example.com')).toBe('example.com')
  })

  it('returns null for empty / non-http(s) / invalid URLs', () => {
    expect(tabOrigin(undefined)).toBeNull()
    expect(tabOrigin('')).toBeNull()
    expect(tabOrigin('about:blank')).toBeNull()
    expect(tabOrigin('javascript:alert(1)')).toBeNull()
    expect(tabOrigin('data:text/plain;base64,aGk=')).toBeNull()
    expect(tabOrigin('not a url')).toBeNull()
  })

  it('treats www vs apex as different hosts', () => {
    expect(tabOrigin('https://www.example.com')).not.toBe(tabOrigin('https://api.example.com'))
  })
})

describe('groupTabsByOrigin', () => {
  it('flags groups only when 2+ tabs share an origin', () => {
    const tabs = [
      tab({ id: 'a', url: 'https://a.com' }),
      tab({ id: 'b', url: 'https://a.com/path' }),
      tab({ id: 'c', url: 'https://other.com' }),
      tab({ id: 'd', url: 'about:blank' }),
    ]
    const result = groupTabsByOrigin(tabs)
    expect(result[0]).toEqual({ groupId: 'a.com', peerCount: 1 })
    expect(result[1]).toEqual({ groupId: 'a.com', peerCount: 1 })
    expect(result[2]).toEqual({ groupId: null, peerCount: 0 })
    expect(result[3]).toEqual({ groupId: null, peerCount: 0 })
  })

  it('returns zero peers when the list has a single origin', () => {
    const result = groupTabsByOrigin([tab({ url: 'https://solo.com' })])
    expect(result[0]).toEqual({ groupId: null, peerCount: 0 })
  })
})

describe('idsToCloseForSameDomain', () => {
  it('returns every non-pinned sibling on the same origin', () => {
    const tabs = [
      tab({ id: 'keep', url: 'https://a.com' }),
      tab({ id: 'close-1', url: 'https://a.com/other' }),
      tab({ id: 'close-2', url: 'https://a.com' }),
      tab({ id: 'pinned', url: 'https://a.com', pinned: true }),
      tab({ id: 'other', url: 'https://b.com' }),
    ]
    expect(idsToCloseForSameDomain(tabs, 'keep').sort()).toEqual(['close-1', 'close-2'])
  })

  it('returns empty when anchor has no http(s) url', () => {
    const tabs = [
      tab({ id: 'anchor', url: 'about:blank' }),
      tab({ id: 'sibling', url: 'about:blank' }),
    ]
    expect(idsToCloseForSameDomain(tabs, 'anchor')).toEqual([])
  })
})