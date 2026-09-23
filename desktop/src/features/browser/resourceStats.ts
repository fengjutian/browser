import type { BrowserTab } from '../../types'

export interface ResourceStatsInputs {
  tabs: BrowserTab[]
  /** Tab ids the caller believes are still backed by a native webview. */
  liveIds: ReadonlySet<string>
  /** Origins currently holding an active download. */
  downloadingOrigins: ReadonlySet<string>
  /** lastActiveAt timestamps (epoch ms). */
  lastActiveAt: ReadonlyMap<string, number>
  /** Reference timestamp (test seam). */
  now?: number
}

export interface ResourceStats {
  totalTabs: number
  liveTabs: number
  suspendedTabs: number
  pinnedTabs: number
  audibleTabs: number
  mutedTabs: number
  downloadingTabs: number
  idleMinutes: number
}

function originOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin || null
  } catch {
    return null
  }
}

/**
 * Pure helper used by the resource popover. Aggregates browser tab stats so the
 * caller can render a single panel without recomputing inside the component.
 */
export function computeResourceStats(inputs: ResourceStatsInputs): ResourceStats {
  const now = inputs.now ?? Date.now()
  let liveTabs = 0
  let pinnedTabs = 0
  let audibleTabs = 0
  let mutedTabs = 0
  let downloadingTabs = 0
  let oldestActive = now
  for (const tab of inputs.tabs) {
    const isLive = inputs.liveIds.has(tab.id)
    if (isLive) liveTabs += 1
    if (tab.pinned) pinnedTabs += 1
    if (tab.audible) audibleTabs += 1
    if (tab.muted) mutedTabs += 1
    const origin = originOf(tab.url)
    if (origin && inputs.downloadingOrigins.has(origin)) downloadingTabs += 1
    const last = inputs.lastActiveAt.get(tab.id) ?? 0
    if (last > 0 && last < oldestActive) oldestActive = last
  }
  const idleMinutes = inputs.tabs.length ? Math.max(0, Math.round((now - oldestActive) / 60_000)) : 0
  return {
    totalTabs: inputs.tabs.length,
    liveTabs,
    suspendedTabs: inputs.tabs.length - liveTabs,
    pinnedTabs,
    audibleTabs,
    mutedTabs,
    downloadingTabs,
    idleMinutes,
  }
}