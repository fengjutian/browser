/**
 * Pure helpers for the workspace UI. The Rust commands do the real I/O; this
 * module just shapes inputs (name/description validation) and normalises the
 * display row list.
 */

import { deleteWorkspace, listWorkspaces, saveWorkspace, type WorkspaceSummary } from '../../services/workspaces'

export interface WorkspaceDisplayRow extends WorkspaceSummary {
  /** Friendly wait time, e.g. "刚刚" / "3 分钟前". */
  relativeUpdated: string
  /** True when the workspace holds zero captured tabs. */
  isEmpty: boolean
}

/**
 * Map the most recent update timestamp into a friendly relative string.
 * Uses the same minute / hour bucketing as the download queue so the UI feels
 * consistent.
 */
export function relativeUpdatedAt(updatedAt: string, now: number = Date.now()): string {
  const parsed = Date.parse(updatedAt)
  if (!Number.isFinite(parsed)) return updatedAt
  const diff = Math.max(0, now - parsed)
  if (diff < 60_000) return '刚刚'
  const min = Math.floor(diff / 60_000)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return updatedAt.slice(0, 10)
}

export function decorateSummaries(items: WorkspaceSummary[], now: number = Date.now()): WorkspaceDisplayRow[] {
  return items.map(item => ({
    ...item,
    relativeUpdated: relativeUpdatedAt(item.updatedAt, now),
    isEmpty: item.tabCount <= 0,
  }))
}

const NAME_MAX = 80
const DESC_MAX = 240

export interface WorkspaceValidationResult {
  ok: boolean
  reason?: string
}

/** Strict name validation (non-empty after trim, max 80 chars). */
export function validateWorkspaceName(name: string): WorkspaceValidationResult {
  const trimmed = name.trim()
  if (trimmed.length === 0) return { ok: false, reason: '名称不能为空' }
  if ([...trimmed].length > NAME_MAX) return { ok: false, reason: `名称最多 ${NAME_MAX} 个字符` }
  return { ok: true }
}

/** Optional description validation (max 240 chars). */
export function validateWorkspaceDescription(description: string): WorkspaceValidationResult {
  if ([...description].length > DESC_MAX) return { ok: false, reason: `描述最多 ${DESC_MAX} 个字符` }
  return { ok: true }
}

export { listWorkspaces, saveWorkspace, deleteWorkspace }
export type { WorkspaceSummary }