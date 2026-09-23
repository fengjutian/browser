import { describe, expect, it } from 'vitest'
import type { BrowserTab } from '../../types'
import { planLruSweep, shouldKeepTabLive, type DownloadActivity } from './lruPolicy'

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

describe('shouldKeepTabLive', () => {
  it('keeps pinned tabs alive regardless of other state', () => {
    expect(shouldKeepTabLive(tab({ id: 'p', pinned: true }), [], NOW)).toBe(true)
  })

  it('keeps audible tabs alive unless explicitly muted', () => {
    expect(shouldKeepTabLive(tab({ id: 'a', url: 'https://a.com', audible: true }), [], NOW)).toBe(true)
    expect(shouldKeepTabLive(tab({ id: 'a', url: 'https://a.com', audible: true, muted: true }), [], NOW)).toBe(false)
  })

  it('keeps tabs whose origin is actively downloading', () => {
    const downloads: DownloadActivity[] = [
      { status: 'downloading', sourceOrigin: 'https://a.com' },
      { status: 'failed', sourceOrigin: 'https://b.com' },
    ]
    expect(shouldKeepTabLive(tab({ id: 'd1', url: 'https://a.com/path' }), downloads, NOW)).toBe(true)
    expect(shouldKeepTabLive(tab({ id: 'd2', url: 'https://b.com' }), downloads, NOW)).toBe(false)
  })

  it('ignores tabs with no url', () => {
    expect(shouldKeepTabLive(tab({ id: 'n', url: '' }), [], NOW)).toBe(false)
  })
})

describe('planLruSweep', () => {
  const tabs = [
    tab({ id: 'pinned', url: 'https://a.com', pinned: true }),
    tab({ id: 'audible', url: 'https://b.com', audible: true }),
    tab({ id: 'down', url: 'https://c.com' }),
    tab({ id: 'recent', url: 'https://d.com' }),
    tab({ id: 'stale', url: 'https://e.com' }),
  ]
  const liveIds = new Set(tabs.map(t => t.id))
  const lastActiveAt = new Map<string, number>([
    ['pinned', NOW - 1000],
    ['audible', NOW - 1000],
    ['down', NOW - 1000],
    ['recent', NOW - 30_000],
    ['stale', NOW - 600_000],
  ])
  const activeDownloads: DownloadActivity[] = [{ status: 'downloading', sourceOrigin: 'https://c.com' }]

  it('returns nothing when live count is within budget', () => {
    const plan = planLruSweep({
      tabs, liveIds: new Set(['pinned', 'recent']),
      lastActiveAt, activeDownloads, protectedId: 'pinned', maxLive: 4, now: NOW,
    })
    expect(plan).toEqual({ toClose: [], kept: [] })
  })

  it('skips pinned / audible / active-download tabs', () => {
    const plan = planLruSweep({
      tabs, liveIds, lastActiveAt, activeDownloads, protectedId: 'pinned',
      maxLive: 2, now: NOW,
    })
    expect(plan.toClose).toEqual(['stale'])
    expect(plan.kept).toEqual(expect.arrayContaining(['audible', 'down', 'recent']))
  })

  it('respects the protectedId even when it is the oldest', () => {
    const plan = planLruSweep({
      tabs, liveIds, lastActiveAt, activeDownloads, protectedId: 'recent',
      maxLive: 2, now: NOW,
    })
    expect(plan.toClose).not.toContain('recent')
    expect(plan.toClose.length).toBe(2)
  })

  it('honours idleThresholdMs by keeping recently used tabs', () => {
    const plan = planLruSweep({
      tabs, liveIds, lastActiveAt, activeDownloads, protectedId: 'pinned',
      maxLive: 2, idleThresholdMs: 120_000, now: NOW,
    })
    // recent was 30s ago (< 120s threshold) so it stays alive; stale is the only
    // candidate old enough to suspend.
    expect(plan.toClose).toEqual(['stale'])
  })
})