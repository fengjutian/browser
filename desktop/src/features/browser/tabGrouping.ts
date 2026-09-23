import type { BrowserTab } from '../../types'

/**
 * Extract the registration-free origin key for a tab URL. Used by the
 * "close same-domain" menu action and the visual group-color hint on the tab
 * strip. `about:blank`, `newtab://` and any other non-http(s) URL collapse into
 * `null` so they do not accidentally group together.
 */
export function tabOrigin(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.host || null
  } catch {
    return null
  }
}

export interface TabGroupDecision {
  /** Stable id used by the renderer to color/group adjacent tabs. */
  groupId: string | null
  /** How many *other* tabs share the same origin. 0 = no group visible. */
  peerCount: number
}

/**
 * Pure helper: given a tab list, return a `groupId` + peer count for each tab
 * so the renderer can highlight neighbours that share an origin. The groupId
 * is the origin string itself — keeps the renderer free of any map state.
 */
export function groupTabsByOrigin(tabs: BrowserTab[]): TabGroupDecision[] {
  const counts = new Map<string, number>()
  for (const tab of tabs) {
    const origin = tabOrigin(tab.url)
    if (!origin) continue
    counts.set(origin, (counts.get(origin) ?? 0) + 1)
  }
  return tabs.map(tab => {
    const origin = tabOrigin(tab.url)
    if (!origin || (counts.get(origin) ?? 0) < 2) {
      return { groupId: null, peerCount: 0 }
    }
    return { groupId: origin, peerCount: (counts.get(origin) ?? 0) - 1 }
  })
}

/**
 * Return the tab ids that should be closed for a "close same-domain" menu
 * action. Excludes the anchor tab itself, pinned tabs, and any tab whose origin
 * does not match the anchor's origin.
 */
export function idsToCloseForSameDomain(tabs: BrowserTab[], anchorId: string): string[] {
  const anchor = tabs.find(tab => tab.id === anchorId)
  const anchorOrigin = tabOrigin(anchor?.url)
  if (!anchorOrigin) return []
  return tabs
    .filter(tab => tab.id !== anchorId && !tab.pinned)
    .filter(tab => tabOrigin(tab.url) === anchorOrigin)
    .map(tab => tab.id)
}