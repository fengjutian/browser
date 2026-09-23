import { invoke } from '@tauri-apps/api/core'

export interface SessionLockState {
  startedAt: number
  updatedAt: number
  cleanExitAt: number | null
  crashed: boolean
}

const isTauri = () => '__TAURI_INTERNALS__' in window

export async function getSessionLockState(): Promise<SessionLockState | null> {
  if (!isTauri()) return null
  try {
    return await invoke<SessionLockState>('browser_session_status')
  } catch {
    return null
  }
}

export async function dropSessionLock(): Promise<void> {
  if (!isTauri()) return
  try {
    await invoke('browser_session_drop')
  } catch {
    /* ignore */
  }
}