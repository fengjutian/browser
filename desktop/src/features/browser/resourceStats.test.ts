import { describe, expect, it } from 'vitest'
import type { BrowserTab } from '../../types'
import { computeResourceStats } from './resourceStats'

function tab(partial: Partial<BrowserTab>): BrowserTab {
  return {
    id: partial.id ?? 'tab',
    url: partial.url ?? 'about:blank',
    title: partial.title ?? 'tab',
    loading: false,
    active: false,
    pinned: partial.pinned ?? false,
    muted: partial.muted,
    audible: partial.audible,
    ...partial,
  } as BrowserTab
}

const NOW = 1_700_000_000_000

describe('computeResourceStats', () => {
  it('reports empty stats for no tabs', () => {
    const stats = computeResourceStats({
      tabs: [], liveIds: new Set(), downloadingOrigins: new Set(), lastActiveAt: new Map(), now: NOW,
    })
    expect(stats).toEqual({
      totalTabs: 0, liveTabs: 0, suspendedTabs: 0, pinnedTabs: 0, audibleTabs: 0, mutedTabs: 0, downloadingTabs: 0, idleMinutes: 0,
    })
  })

  it('aggregates pinned / audible / muted / live counts', () => {
    const tabs = [
      tab({ id: 'a', pinned: true }),
      tab({ id: 'b', audible: true }),
      tab({ id: 'c', muted: true }),
      tab({ id: 'd' }),
    ]
    const liveIds = new Set(['a', 'b', 'c'])
    const stats = computeResourceStats({
      tabs, liveIds, downloadingOrigins: new Set(), lastActiveAt: new Map([
        ['a', NOW - 60_000],
        ['b', NOW - 30_000],
        ['c', NOW - 5_000],
        ['d', NOW - 600_000],
      ]), now: NOW,
    })
    expect(stats.totalTabs).toBe(4)
    expect(stats.liveTabs).toBe(3)
    expect(stats.suspendedTabs).toBe(1)
    expect(stats.pinnedTabs).toBe(1)
    expect(stats.audibleTabs).toBe(1)
    expect(stats.mutedTabs).toBe(1)
    expect(stats.idleMinutes).toBe(10) // oldest of (1m, 30s, 5s, 10m) is 10m
  })

  it('counts tabs whose origin matches an active download', () => {
    const tabs = [
      tab({ id: 'd1', url: 'https://a.com/x' }),
      tab({ id: 'd2', url: 'https://b.com' }),
    ]
    const downloading = new Set(['https://a.com'])
    const stats = computeResourceStats({
      tabs, liveIds: new Set(['d1', 'd2']), downloadingOrigins: downloading, lastActiveAt: new Map(), now: NOW,
    })
    expect(stats.downloadingTabs).toBe(1)
  })
})