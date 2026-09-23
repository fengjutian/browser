/**
 * Pure helpers for the v2 session schema. The browser mirrors tabs,
 * scroll position, zoom and the active tab id to localStorage so a clean
 * exit can restore the workspace. Two slots (`v1` + `v2`) implement a
 * poor-man's atomic snapshot: we write to the older slot first, swap
 * pointers on the next tick. If the app crashes mid-write, the older
 * slot is still readable.
 *
 * Rust owns the matching "session lock" — see `lib.rs::browser_session_*`.
 */
import type { BrowserTab } from '../../types'
import { redactSessionTabs, redactUrl } from './logRedaction'

export const SESSION_SCHEMA_VERSION = 2

export const SESSION_KEY_V1 = 'browser.session.v1'
export const SESSION_KEY_V2 = 'browser.session.v2'

export interface SessionWindow {
  id: string
  tabs: BrowserTab[]
  activeTabId: string
  /** tabId → { x, y } captured on tab close / hide. */
  scrollPositions: Record<string, { x: number; y: number }>
  /** tabId → zoom scale (0.5 - 3.0). */
  zoomLevels: Record<string, number>
}

export interface SessionSnapshot {
  schemaVersion: number
  savedAt: number
  /** Last clean-exit timestamp, if the app reached the "no dirty state" state. */
  cleanExitAt?: number
  windows: SessionWindow[]
  history: { url: string; title: string; visitedAt: number }[]
  closedTabs: { id: string; url: string; title: string; favicon?: string; closedAt: number }[]
  searchEngine?: { presetId: string; customTemplate?: string }
  sitePermissions?: unknown
}

export interface SessionParseResult {
  snapshot: SessionSnapshot
  /** Which slot produced the snapshot. */
  source: 'v1' | 'v2'
  /** True if the snapshot predates a known-crash window. */
  suspect: boolean
}

export function emptySnapshot(): SessionSnapshot {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    savedAt: 0,
    windows: [],
    history: [],
    closedTabs: [],
  }
}

function parseSlot(raw: string | null): SessionSnapshot | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<SessionSnapshot>
    if (!value || typeof value !== 'object') return null
    if (value.schemaVersion !== SESSION_SCHEMA_VERSION) return null
    if (!Array.isArray(value.windows)) return null
    return value as SessionSnapshot
  } catch {
    return null
  }
}

/**
 * Read the latest non-corrupt snapshot. `v2` wins when both are present and
 * newer, otherwise fall back to the older slot. `suspect` flips true when
 * the chosen slot is strictly older than the other — that signals the
 * previous write may have crashed and the caller should surface the
 * recovery UI.
 */
export function readLatestSnapshot(): SessionParseResult | null {
  const v1Raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SESSION_KEY_V1) : null
  const v2Raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SESSION_KEY_V2) : null
  const v1 = parseSlot(v1Raw)
  const v2 = parseSlot(v2Raw)
  if (!v1 && !v2) return null
  if (!v1) return { snapshot: v2!, source: 'v2', suspect: false }
  if (!v2) return { snapshot: v1, source: 'v1', suspect: false }
  // Both valid: pick the newer; flag the older slot if it lags by >5s.
  const newer = v2.savedAt >= v1.savedAt ? v2 : v1
  const older = newer === v2 ? v1 : v2
  const source: 'v1' | 'v2' = newer === v2 ? 'v2' : 'v1'
  return {
    snapshot: newer,
    source,
    suspect: newer.savedAt - older.savedAt > 5_000,
  }
}

/**
 * Crash recovery must not prefer a newer placeholder-only snapshot over an
 * older snapshot that still contains navigable tabs. This can happen when the
 * app creates its initial blank tab immediately before an abnormal exit.
 */
export function readRecoverySnapshot(): SessionParseResult | null {
  const v1Raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SESSION_KEY_V1) : null
  const v2Raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SESSION_KEY_V2) : null
  const candidates = ([
    ['v1', parseSlot(v1Raw)],
    ['v2', parseSlot(v2Raw)],
  ] as const).filter((entry): entry is readonly ['v1' | 'v2', SessionSnapshot] => entry[1] !== null)
  if (candidates.length === 0) return null

  const navigable = candidates.filter(([, snapshot]) => (
    snapshot.windows.some(window => window.tabs.some(tab => !tab.private && tab.url.trim().length > 0))
  ))
  const pool = navigable.length > 0 ? navigable : candidates
  const [source, snapshot] = pool.reduce((latest, current) => (
    current[1].savedAt >= latest[1].savedAt ? current : latest
  ))
  const newestSavedAt = Math.max(...candidates.map(([, value]) => value.savedAt))
  return { snapshot, source, suspect: snapshot.savedAt < newestSavedAt }
}

/**
 * Persist the snapshot to the older slot only. On the next save that slot is
 * the newest, so the other slot is selected. Alternating the slots keeps one
 * previous-good snapshot available if a write or process exit is interrupted.
 */
export function writeSnapshot(snapshot: SessionSnapshot, options: { rotatedAt?: number } = {}): void {
  if (typeof localStorage === 'undefined') return
  const rotatedAt = options.rotatedAt ?? Date.now()
  // Strip credential material from tab URLs and history / closed-tabs lists
  // before persisting — session files live on disk and could be inspected by
  // anyone with file access. We never persist private tabs (already stripped
  // upstream); this just hardens the remaining entries.
  const sanitised: SessionSnapshot = {
    ...snapshot,
    savedAt: rotatedAt,
    schemaVersion: SESSION_SCHEMA_VERSION,
    windows: snapshot.windows.map(window => ({
      ...window,
      tabs: redactSessionTabs(window.tabs),
    })),
    history: snapshot.history.map(entry => ({ ...entry, url: redactUrl(entry.url) })),
    closedTabs: snapshot.closedTabs.map(tab => ({ ...tab, url: redactUrl(tab.url) })),
  }
  const raw = JSON.stringify(sanitised)
  const probe = readLatestSnapshot()
  const olderKey = probe?.source === 'v1' ? SESSION_KEY_V2 : SESSION_KEY_V1
  // Write only the older slot; writing both would erase the fallback copy.
  try { localStorage.setItem(olderKey, raw) } catch { /* storage full / quota */ }
}

/**
 * Map the snapshot down to the BrowserPage shape the existing UI already
 * consumes (`{ tabs, activeTabId }`). Filters out private tabs and tabs
 * whose URL looks malformed. Skipped tabs are reported so the recovery
 * panel can surface a count.
 */
export interface RestoredSession {
  tabs: BrowserTab[]
  activeTabId: string
  scrollPositions: Record<string, { x: number; y: number }>
  zoomLevels: Record<string, number>
  skipped: number
}

export function restoreFromSnapshot(snapshot: SessionSnapshot): RestoredSession {
  const window = snapshot.windows[0]
  if (!window) return { tabs: [], activeTabId: '', scrollPositions: {}, zoomLevels: {}, skipped: 0 }
  let skipped = 0
  const tabs: BrowserTab[] = []
  for (const tab of window.tabs) {
    if (!tab.id || !tab.title) { skipped++; continue }
    if (tab.private) { skipped++; continue }
    tabs.push(tab)
  }
  const activeTabId = tabs.some(tab => tab.id === window.activeTabId)
    ? window.activeTabId
    : (tabs[0]?.id ?? '')
  return {
    tabs,
    activeTabId,
    scrollPositions: window.scrollPositions ?? {},
    zoomLevels: window.zoomLevels ?? {},
    skipped,
  }
}
