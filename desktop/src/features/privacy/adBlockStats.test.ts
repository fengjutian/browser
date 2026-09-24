import { afterEach, describe, expect, it } from 'vitest'
import {
  domainFromUrl,
  getAdBlockStats,
  onAdBlockStatsChange,
  recordAdBlock,
  resetAdBlockStats,
  resetSessionAdBlockStats,
} from './adBlockStats'

afterEach(() => {
  resetAdBlockStats()
  localStorage.clear()
})

describe('recordAdBlock', () => {
  it('increments total and session counters', () => {
    recordAdBlock('example.com', 3)
    const stats = getAdBlockStats()
    expect(stats.totalBlocked).toBe(3)
    expect(stats.sessionBlocked).toBe(3)
    expect(stats.byDomain['example.com']).toBe(3)
  })

  it('accumulates across multiple calls', () => {
    recordAdBlock('example.com', 2)
    recordAdBlock('example.com', 5)
    recordAdBlock('other.com', 1)
    const stats = getAdBlockStats()
    expect(stats.totalBlocked).toBe(8)
    expect(stats.sessionBlocked).toBe(8)
    expect(stats.byDomain['example.com']).toBe(7)
    expect(stats.byDomain['other.com']).toBe(1)
  })

  it('ignores zero and negative deltas', () => {
    recordAdBlock('example.com', 0)
    recordAdBlock('example.com', -3)
    expect(getAdBlockStats().totalBlocked).toBe(0)
  })

  it('sorts domainEntries by count descending', () => {
    recordAdBlock('low.com', 1)
    recordAdBlock('high.com', 10)
    recordAdBlock('mid.com', 5)
    const { domainEntries } = getAdBlockStats()
    expect(domainEntries.map(entry => entry.domain)).toEqual(['high.com', 'mid.com', 'low.com'])
  })

  it('updates lastUpdated timestamp', () => {
    const before = Date.now()
    recordAdBlock('example.com', 1)
    expect(getAdBlockStats().lastUpdated).toBeGreaterThanOrEqual(before)
  })
})

describe('persistence', () => {
  it('survives a read cycle via localStorage', () => {
    recordAdBlock('example.com', 4)
    const raw = JSON.parse(localStorage.getItem('arcadia-adblock-stats.v1') ?? '{}')
    expect(raw.totalBlocked).toBe(4)
    expect(raw.byDomain['example.com']).toBe(4)
  })
})

describe('resetAdBlockStats', () => {
  it('clears all counters and domain data', () => {
    recordAdBlock('example.com', 10)
    resetAdBlockStats()
    const stats = getAdBlockStats()
    expect(stats.totalBlocked).toBe(0)
    expect(stats.sessionBlocked).toBe(0)
    expect(stats.domainEntries).toEqual([])
  })
})

describe('resetSessionAdBlockStats', () => {
  it('clears session counter but keeps all-time totals', () => {
    recordAdBlock('example.com', 7)
    resetSessionAdBlockStats()
    const stats = getAdBlockStats()
    expect(stats.totalBlocked).toBe(7)
    expect(stats.sessionBlocked).toBe(0)
    expect(stats.byDomain['example.com']).toBe(7)
  })
})

describe('onAdBlockStatsChange', () => {
  it('fires on record and reset', () => {
    const calls: number[] = []
    const unsubscribe = onAdBlockStatsChange(stats => calls.push(stats.totalBlocked))
    recordAdBlock('a.com', 3)
    recordAdBlock('b.com', 2)
    resetAdBlockStats()
    unsubscribe()
    recordAdBlock('c.com', 1) // should not fire after unsubscribe
    expect(calls).toEqual([3, 5, 0])
  })
})

describe('domainFromUrl', () => {
  it('extracts hostname', () => {
    expect(domainFromUrl('https://example.com/path?q=1')).toBe('example.com')
  })

  it('handles subdomains', () => {
    expect(domainFromUrl('https://sub.example.com:8080/')).toBe('sub.example.com')
  })

  it('returns unknown for invalid URLs', () => {
    expect(domainFromUrl('not a url')).toBe('unknown')
    expect(domainFromUrl('')).toBe('unknown')
  })
})
