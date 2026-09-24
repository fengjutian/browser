import { describe, expect, it } from 'vitest'
import { buildVisitStats, buildVisitTrend, categoryForHostname, filterVisitsByRange, hostnameOf } from './visitStats'

describe('visit statistics', () => {
  it('normalizes hostnames and ignores invalid URLs', () => {
    expect(hostnameOf('https://www.GitHub.com/a')).toBe('github.com')
    expect(hostnameOf('not a url')).toBeNull()
  })
  it('groups visits by site and category', () => {
    const stats = buildVisitStats([
      { url: 'https://github.com/a', title: 'a', visitedAt: 1 },
      { url: 'https://github.com/b', title: 'b', visitedAt: 2 },
      { url: 'https://youtube.com/x', title: 'x', visitedAt: 3 },
    ])
    expect(stats.totalVisits).toBe(3)
    expect(stats.uniqueSites).toBe(2)
    expect(stats.sites[0]).toMatchObject({ label: 'github.com', count: 2 })
    expect(stats.categories.find(item => item.label === '开发技术')?.count).toBe(2)
  })
  it('classifies common website types', () => {
    expect(categoryForHostname('juejin.cn')).toBe('开发技术')
    expect(categoryForHostname('bilibili.com')).toBe('视频娱乐')
    expect(categoryForHostname('unknown.example')).toBe('其他')
  })
  it('filters and buckets visits by time', () => {
    const now = new Date(2026, 8, 24, 12).getTime()
    const entries = [
      { url: 'https://a.com', title: 'today', visitedAt: new Date(2026, 8, 24, 9).getTime() },
      { url: 'https://b.com', title: 'yesterday', visitedAt: new Date(2026, 8, 23, 9).getTime() },
      { url: 'https://c.com', title: 'old', visitedAt: new Date(2026, 7, 1, 9).getTime() },
    ]
    expect(filterVisitsByRange(entries, 'today', now)).toHaveLength(1)
    expect(filterVisitsByRange(entries, '7d', now)).toHaveLength(2)
    expect(buildVisitTrend(entries, 'today', now)[9].count).toBe(1)
  })
})
