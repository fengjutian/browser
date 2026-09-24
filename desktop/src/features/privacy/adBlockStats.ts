/**
 * Persistent ad-block statistics.
 *
 * The Rust init script emits cumulative `blockedCount` per tab via
 * `browser://ad-block-update`. BrowserPage computes the delta (new blocks
 * since the last event for the same tab) and calls `recordAdBlock` with
 * the page's hostname. This module aggregates and persists the data to
 * localStorage so the privacy settings panel can display real statistics.
 */

const STORAGE_KEY = 'arcadia-adblock-stats.v1'
const CHANGE_EVENT = 'arcadia-adblock-stats-change'

export interface AdBlockStats {
  totalBlocked: number
  sessionBlocked: number
  byDomain: Record<string, number>
  lastUpdated: number
}

export interface AdBlockStatsSnapshot extends AdBlockStats {
  domainEntries: Array<{ domain: string; count: number }>
}

const DEFAULT_STATS: AdBlockStats = {
  totalBlocked: 0,
  sessionBlocked: 0,
  byDomain: {},
  lastUpdated: 0,
}

let current: AdBlockStats = readStats()

function readStats(): AdBlockStats {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<AdBlockStats>
    return {
      totalBlocked: Number(raw.totalBlocked) || 0,
      sessionBlocked: Number(raw.sessionBlocked) || 0,
      byDomain: raw.byDomain && typeof raw.byDomain === 'object' ? { ...raw.byDomain } : {},
      lastUpdated: Number(raw.lastUpdated) || 0,
    }
  } catch {
    return { ...DEFAULT_STATS, byDomain: {} }
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch { /* quota exceeded – best effort */ }
  window.dispatchEvent(new CustomEvent<AdBlockStats>(CHANGE_EVENT, { detail: cloneStats() }))
}

function cloneStats(): AdBlockStats {
  return { ...current, byDomain: { ...current.byDomain } }
}

/**
 * Record `delta` new ad-blocks for `domain`. Called by BrowserPage each time
 * the cumulative counter for a tab increases.
 */
export function recordAdBlock(domain: string, delta: number): void {
  if (delta <= 0) return
  current.totalBlocked += delta
  current.sessionBlocked += delta
  current.byDomain[domain] = (current.byDomain[domain] ?? 0) + delta
  current.lastUpdated = Date.now()
  persist()
}

/** Return a snapshot with pre-sorted domain entries for display. */
export function getAdBlockStats(): AdBlockStatsSnapshot {
  const entries = Object.entries(current.byDomain)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
  return { ...cloneStats(), domainEntries: entries }
}

/** Reset all-time and session counters. */
export function resetAdBlockStats(): void {
  current = { ...DEFAULT_STATS, byDomain: {} }
  persist()
}

/** Reset only the session counter (keeps all-time totals). */
export function resetSessionAdBlockStats(): void {
  current.sessionBlocked = 0
  persist()
}

/** Subscribe to stat changes (dispatched on every record / reset). */
export function onAdBlockStatsChange(handler: (stats: AdBlockStats) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<AdBlockStats>).detail)
  window.addEventListener(CHANGE_EVENT, listener)
  return () => window.removeEventListener(CHANGE_EVENT, listener)
}

/** Extract the hostname from a URL for domain grouping. */
export function domainFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname || 'unknown'
  } catch {
    return 'unknown'
  }
}
