import type { HistoryEntry } from './dedupeHistory'

export type SiteCategory = '开发技术' | '视频娱乐' | '社交社区' | '搜索工具' | '购物' | '其他'
export interface VisitStat { key: string; label: string; count: number; percentage: number }

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
