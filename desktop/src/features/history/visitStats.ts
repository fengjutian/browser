import type { HistoryEntry } from './dedupeHistory'

export type SiteCategory = '开发技术' | '视频娱乐' | '社交社区' | '搜索工具' | '购物' | '其他'
export interface VisitStat { key: string; label: string; count: number; percentage: number }
export type VisitTimeRange = 'today' | '7d' | '30d' | 'all'
export interface VisitTrendPoint { key: string; label: string; count: number }

const CATEGORY_RULES: Array<[SiteCategory, RegExp]> = [
  ['开发技术', /(^|\.)(github|gitlab|juejin|csdn|stackoverflow|stackexchange|npmjs|mdn|developer\.mozilla)\./i],
  ['视频娱乐', /(^|\.)(bilibili|youtube|youku|iqiyi|vimeo|netflix|douyin)\./i],
  ['社交社区', /(^|\.)(weibo|zhihu|reddit|x|twitter|facebook|instagram|xiaohongshu)\./i],
  ['搜索工具', /(^|\.)(google|bing|baidu|duckduckgo|yahoo)\./i],
  ['购物', /(^|\.)(taobao|tmall|jd|amazon|pinduoduo)\./i],
]

export function hostnameOf(rawUrl: string): string | null {
  try { return new URL(rawUrl).hostname.replace(/^www\./i, '').toLocaleLowerCase() || null }
  catch { return null }
}

export function categoryForHostname(hostname: string): SiteCategory {
  return CATEGORY_RULES.find(([, rule]) => rule.test(`${hostname}.`))?.[0] ?? '其他'
}

function finalize(counts: Map<string, number>, total: number): VisitStat[] {
  return [...counts].map(([key, count]) => ({ key, label: key, count, percentage: total ? count / total * 100 : 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'))
}

export function buildVisitStats(entries: HistoryEntry[], topLimit = 10) {
  const sites = new Map<string, number>()
  const categories = new Map<string, number>()
  let validVisits = 0
  for (const entry of entries) {
    const hostname = hostnameOf(entry.url)
    if (!hostname) continue
    validVisits += 1
    sites.set(hostname, (sites.get(hostname) ?? 0) + 1)
    const category = categoryForHostname(hostname)
    categories.set(category, (categories.get(category) ?? 0) + 1)
  }
  return {
    totalVisits: validVisits,
    uniqueSites: sites.size,
    sites: finalize(sites, validVisits).slice(0, topLimit),
    categories: finalize(categories, validVisits),
  }
}

export function filterVisitsByRange(entries: HistoryEntry[], range: VisitTimeRange, now = Date.now()): HistoryEntry[] {
  if (range === 'all') return entries
  const date = new Date(now)
  const cutoff = range === 'today'
    ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    : now - (range === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000
  return entries.filter(entry => entry.visitedAt >= cutoff && entry.visitedAt <= now)
}

export function buildVisitTrend(entries: HistoryEntry[], range: VisitTimeRange, now = Date.now()): VisitTrendPoint[] {
  const filtered = filterVisitsByRange(entries, range, now)
  if (range === 'today') {
    const hours = Array.from({ length: 24 }, (_, hour) => ({ key: String(hour), label: `${String(hour).padStart(2, '0')}:00`, count: 0 }))
    for (const entry of filtered) hours[new Date(entry.visitedAt).getHours()].count += 1
    return hours
  }
  const days = range === '7d' ? 7 : range === '30d' ? 30 : Math.min(30, Math.max(1, Math.ceil((now - Math.min(now, ...filtered.map(item => item.visitedAt))) / 86_400_000) + 1))
  const points: VisitTrendPoint[] = []
  const index = new Map<string, VisitTrendPoint>()
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(now); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - offset)
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
    const point = { key, label: `${date.getMonth() + 1}/${date.getDate()}`, count: 0 }
    points.push(point); index.set(key, point)
  }
  for (const entry of filtered) {
    const date = new Date(entry.visitedAt)
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
    const point = index.get(key); if (point) point.count += 1
  }
  return points
}
