import { describe, expect, it } from 'vitest'
import { CLOSED_TABS_MAX, popClosedTab, recordClosedTab, type ClosedTab } from './closedTabs'

function tab(url: string, overrides: Partial<ClosedTab> = {}): ClosedTab {
  return { id: `id-${url}`, url, title: url, closedAt: 0, ...overrides }
}

describe('closedTabs', () => {
  it('keeps most-recently-closed at the front and dedupes by url', () => {
    const initial: ClosedTab[] = [tab('https://a'), tab('https://b')]
    const next = recordClosedTab(initial, tab('https://a'))
    expect(next.map(item => item.url)).toEqual(['https://a', 'https://b'])
  })

  it('caps history at CLOSED_TABS_MAX entries', () => {
    let closed: ClosedTab[] = []
    for (let i = 0; i < CLOSED_TABS_MAX + 5; i++) closed = recordClosedTab(closed, tab(`https://x${i}`))
    expect(closed.length).toBe(CLOSED_TABS_MAX)
    expect(closed[0].url).toBe(`https://x${CLOSED_TABS_MAX + 4}`)
    expect(closed.at(-1)?.url).toBe(`https://x5`)
  })

  it('re-promotes a duplicate url without growing the list', () => {
    let closed: ClosedTab[] = []
    closed = recordClosedTab(closed, tab('https://a', { closedAt: 1 }))
    closed = recordClosedTab(closed, tab('https://b', { closedAt: 2 }))
    closed = recordClosedTab(closed, tab('https://c', { closedAt: 3 }))
    closed = recordClosedTab(closed, tab('https://a', { closedAt: 4 }))
    expect(closed.map(item => item.url)).toEqual(['https://a', 'https://c', 'https://b'])
    expect(closed.length).toBe(3)
  })

  it('pops the most-recently-closed and returns the remainder', () => {
    const closed = [tab('https://a'), tab('https://b')]
    const result = popClosedTab(closed)
    expect(result?.popped.url).toBe('https://a')
    expect(result?.remaining.map(item => item.url)).toEqual(['https://b'])
  })

  it('returns null when nothing is closed', () => {
    expect(popClosedTab([])).toBeNull()
  })
})
