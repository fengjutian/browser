/**
 * Pure diff between the current tab list and a saved workspace payload.
 * Returns the next-state tab list plus the target active tab id. Existing
 * tabs that already match a saved entry keep their runtime state (loading,
 * session data); new tabs are inserted in saved order; tabs not present in
 * the snapshot are dropped.
 */
import type { BrowserTab } from '../../types'
import type { WorkspaceRecord } from '../../services/workspaces'

export interface RestoreResult {
  tabs: BrowserTab[]
  activeTabId: string
  /** Number of tabs that had to be re-opened (id was new). */
  addedCount: number
  /** Number of tabs that were dropped from the existing window. */
  removedCount: number
}

export interface WorkspaceTabSnapshot {
  id: string
  url: string
  title: string
  favicon?: string | null
  pinned?: boolean
  muted?: boolean
  audible?: boolean
  private?: boolean
  groupId?: string | null
}

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function normaliseSnapshot(raw: unknown, fallbackId: string): WorkspaceTabSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const id = firstString(value.id) ?? fallbackId
  const url = firstString(value.url)
  if (!url) return null
  const title = firstString(value.title) ?? url
  const favicon = typeof value.favicon === 'string' ? value.favicon : null
  const pinned = value.pinned === true
  const muted = value.muted === true
  const audible = value.audible === true
  const privateFlag = value.private === true
  const groupId = typeof value.groupId === 'string' ? value.groupId : null
  return { id, url, title, favicon, pinned, muted, audible, private: privateFlag, groupId }
}

/** Normalise a workspace payload into an ordered list of tab snapshots. */
export function snapshotsFromWorkspace(workspace: WorkspaceRecord | null | undefined): { snapshots: WorkspaceTabSnapshot[]; activeTabId: string } {
  const empty = { snapshots: [] as WorkspaceTabSnapshot[], activeTabId: '' }
  if (!workspace || typeof workspace !== 'object') return empty
  const rawTabs = Array.isArray(workspace.payload?.tabs) ? workspace.payload.tabs : []
  if (rawTabs.length === 0) return empty
  const fallbackId = firstString(workspace.payload?.activeTabId) ?? 'ws-restored'
  const snapshots: WorkspaceTabSnapshot[] = []
  rawTabs.forEach((raw, index) => {
    const id = `${fallbackId}-${index}`
    const normalised = normaliseSnapshot(raw, id)
    if (normalised) snapshots.push(normalised)
  })
  if (snapshots.length === 0) return empty
  const active = firstString(workspace.payload?.activeTabId)
  const targetActive = active && snapshots.some(item => item.id === active) ? active : snapshots[0]?.id ?? fallbackId
  return { snapshots, activeTabId: targetActive }
}

/**
 * Compute the new tab list by overlaying the snapshot onto the current set.
 *
 * Existing tabs whose id is in the snapshot keep their runtime fields
 * (loading / error / nativeHandle). The snapshot's url/title/favicon/pinned/
 * muted/audible/private/groupId overwrite the matching fields so a restore
 * reflects the saved state, not a stale network load.
 */
export function restoreTabsFromWorkspace(current: readonly BrowserTab[], workspace: WorkspaceRecord | null | undefined): RestoreResult {
  const { snapshots, activeTabId } = snapshotsFromWorkspace(workspace)
  if (snapshots.length === 0) {
    return { tabs: current.slice(), activeTabId: current[0]?.id ?? activeTabId, addedCount: 0, removedCount: 0 }
  }
  const snapById = new Map(snapshots.map(snap => [snap.id, snap]))
  const seen = new Set<string>()
  const next: BrowserTab[] = []
  let added = 0

  // Keep any current tab whose id matches a snapshot, but merge the snapshot
  // metadata (url/title/...) so the user sees the saved state.
  for (const tab of current) {
    const snap = snapById.get(tab.id)
    if (!snap) continue
    seen.add(tab.id)
    next.push({
      ...tab,
      url: snap.url,
      title: snap.title,
      favicon: snap.favicon ?? tab.favicon ?? undefined,
      pinned: snap.pinned ?? tab.pinned,
      muted: snap.muted ?? tab.muted,
      audible: snap.audible ?? tab.audible,
      private: snap.private ?? tab.private,
      groupId: snap.groupId ?? tab.groupId ?? undefined,
      crashed: false,
    })
  }

  // Add snapshots for tabs that are not in the current list (preserve order).
  for (const snap of snapshots) {
    if (seen.has(snap.id)) continue
    added += 1
    next.push({
      id: snap.id,
      url: snap.url,
      title: snap.title,
      favicon: snap.favicon ?? undefined,
      loading: true,
      active: false,
      pinned: snap.pinned ?? false,
      private: snap.private ?? false,
      muted: snap.muted ?? false,
      audible: snap.audible ?? false,
      crashed: false,
      groupId: snap.groupId ?? undefined,
    })
  }

  const removedCount = current.filter(tab => !snapById.has(tab.id)).length
  const safeActive = next.some(tab => tab.id === activeTabId) ? activeTabId : next[0]?.id ?? activeTabId
  return { tabs: next, activeTabId: safeActive, addedCount: added, removedCount }
}