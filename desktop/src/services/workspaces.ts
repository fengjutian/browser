import { invoke } from '@tauri-apps/api/core'

/**
 * Workspace summary returned by `local_list_workspaces`. The `payload`
 * column (tabs JSON) is intentionally omitted to keep the list cheap; fetch
 * the full record via {@link getWorkspace} when the user wants to restore.
 */
export interface WorkspaceSummary {
  id: string
  name: string
  description: string
  tabCount: number
  createdAt: string
  updatedAt: string
}

/**
 * Full workspace record returned by `local_get_workspace`. `payload` carries
 * the raw tab snapshot saved at the time of capture.
 */
export interface WorkspaceRecord extends WorkspaceSummary {
  payload: { tabs?: unknown[]; activeTabId?: string } & Record<string, unknown>
}

export interface WorkspaceSaveInput {
  id?: string
  name: string
  description: string
  payload: WorkspaceRecord['payload']
}

const isTauri = () => '__TAURI_INTERNALS__' in window

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  if (!isTauri()) return []
  return invoke<WorkspaceSummary[]>('local_list_workspaces')
}

export async function getWorkspace(id: string): Promise<WorkspaceRecord | null> {
  if (!isTauri()) return null
  return invoke<WorkspaceRecord | null>('local_get_workspace', { id })
}

export async function saveWorkspace(input: WorkspaceSaveInput): Promise<WorkspaceSummary> {
  if (!isTauri()) throw new Error('saveWorkspace requires Tauri runtime')
  return invoke<WorkspaceSummary>('local_save_workspace', { input })
}

export async function deleteWorkspace(id: string): Promise<void> {
  if (!isTauri()) return
  await invoke('local_delete_workspace', { id })
}

const FALLBACK_PAYLOAD: WorkspaceRecord['payload'] = { tabs: [] }

/**
 * Snapshot a {@link BrowserTab} list into the workspace payload shape. Pinned
 * state, audible flag, and crashed marker are preserved so a restored
 * workspace keeps the user's intent, but history-y fields (loading, last
 * poll) are dropped because we cannot resume a transient network load.
 */
export function snapshotTabsToPayload(tabs: readonly BrowserTabLike[]): WorkspaceRecord['payload'] {
  const cleaned = tabs.map(tab => ({
    id: tab.id,
    url: tab.url,
    title: tab.title,
    favicon: tab.favicon ?? null,
    pinned: tab.pinned === true,
    muted: tab.muted === true,
    audible: tab.audible === true,
    private: tab.private === true,
    groupId: tab.groupId ?? null,
  }))
  return { tabs: cleaned, activeTabId: tabs[0]?.id ?? '' }
}

export function emptyWorkspacePayload(): WorkspaceRecord['payload'] {
  return { ...FALLBACK_PAYLOAD, tabs: [] }
}

export interface BrowserTabLike {
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