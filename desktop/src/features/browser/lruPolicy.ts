import type { BrowserTab } from '../../types'

/**
 * Minimal download record shape we need to decide whether a tab is still
 * "holding" a download. Matches `NativeDownloadUpdate.status` for the running
 * cases — anything in-flight keeps the underlying webview alive so the user
 * can read progress.
 */
export interface DownloadActivity { status: string; sourceOrigin?: string }

/**
 * Decide which tabs must be **kept live** when the LRU sweep runs. The caller
 * is responsible for sorting by `lastActiveAt` and trimming to `maxLive`;
 * this helper just answers "would suspending this tab break something?". We
 * intentionally only flag pinned/audible/in-flight-download as protected —
 * everything else is fair game for suspension.
 */
export function shouldKeepTabLive(
  tab: BrowserTab,
  activeDownloads: ReadonlyArray<DownloadActivity>,
  now = Date.now(),
  idleThresholdMs = Number.POSITIVE_INFINITY,
): boolean {
  if (tab.pinned) return true
  if (tab.audible && !tab.muted) return true
  if (tab.url) {
    try {
      const origin = new URL(tab.url).origin
      if (origin && activeDownloads.some(item => item.status === 'downloading' && item.sourceOrigin === origin)) {
        return true
      }
    } catch { /* ignore non-http URLs */ }
  }
  return false
}

export interface LruCandidateInputs {
  tabs: BrowserTab[]
  /** Tab ids that currently own a live native webview. */
  liveIds: ReadonlySet<string>
  /** Last-active timestamp per tab id (epoch ms). Tabs missing fall back to 0. */
  lastActiveAt: ReadonlyMap<string, number>
  /** Active downloads (used by `shouldKeepTabLive`). */
  activeDownloads: ReadonlyArray<DownloadActivity>
  /** The tab the user is currently viewing — never suspended. */
  protectedId: string
  /** Target live webview count. */
  maxLive: number
  /** Optional idle threshold: tabs activated within this window are kept alive. */
  idleThresholdMs?: number
  /** Reference timestamp for idle math (test seam). */
  now?: number
}

export interface LruPlan {
  /** Tabs to close in order; first id is closed first. */
  toClose: string[]
  /** Tabs skipped because they hit the keep-alive whitelist. */
  kept: string[]
}

/**
 * Pure planner: given the current state, return the list of webviews that the
 * caller should suspend. The caller is responsible for actually invoking
 * `closeNativeTab` and updating `lastActiveAt`. This keeps the policy
 * unit-testable without any Tauri runtime.
 */
export function planLruSweep(inputs: LruCandidateInputs): LruPlan {
  const { tabs, lastActiveAt, protectedId, maxLive, activeDownloads } = inputs
  const idleThresholdMs = inputs.idleThresholdMs ?? Number.POSITIVE_INFINITY
  const now = inputs.now ?? Date.now()
  if (inputs.liveIds.size <= maxLive) return { toClose: [], kept: [] }

  const candidates = tabs
    .filter(tab => inputs.liveIds.has(tab.id))
    .filter(tab => tab.id !== protectedId)
    .sort((a, b) => (lastActiveAt.get(a.id) ?? 0) - (lastActiveAt.get(b.id) ?? 0))

  const surplus = inputs.liveIds.size - maxLive
  const toClose: string[] = []
  const kept: string[] = []

  for (const tab of candidates) {
    if (toClose.length >= surplus) break
    if (shouldKeepTabLive(tab, activeDownloads, now, idleThresholdMs)) {
      kept.push(tab.id)
      continue
    }
    const last = lastActiveAt.get(tab.id) ?? 0
    if (now - last < idleThresholdMs) {
      kept.push(tab.id)
      continue
    }
    toClose.push(tab.id)
  }

  return { toClose, kept }
}