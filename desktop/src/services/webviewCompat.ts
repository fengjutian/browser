import { invoke } from '@tauri-apps/api/core'

const isTauri = () => '__TAURI_INTERNALS__' in window

export interface FilePickFilters {
  label: string
  extensions: string[]
}

export interface FilePickOptions {
  title?: string
  multiple?: boolean
  directory?: boolean
  filters?: FilePickFilters[]
}

export interface FilePickResult {
  paths: string[]
}

/**
 * Open the OS file picker and return the chosen file paths. Wraps
 * `tauri-plugin-dialog`'s `pick_file` / `pick_files` / `pick_folder` so the
 * frontend doesn't have to know which dialog variant matches the options.
 */
export async function pickFiles(options: FilePickOptions = {}): Promise<FilePickResult> {
  if (!isTauri()) return { paths: [] }
  return invoke<FilePickResult>('pick_files', { options })
}

/**
 * Open an arbitrary external URL via the system shell. The Rust side
 * refuses http/https and dangerous schemes (javascript:, file:, etc.) —
 * the frontend should only call this for `vscode://`, `slack://`, etc.
 */
export async function shellOpen(url: string): Promise<void> {
  if (!isTauri()) return
  await invoke('shell_open', { url })
}

/**
 * Toggle the main window's fullscreen state. Returns the *new* state so the
 * caller can update its icon. Falls back to `false` in non-Tauri contexts.
 */
export async function toggleFullscreen(): Promise<boolean> {
  if (!isTauri()) return false
  return invoke<boolean>('toggle_fullscreen')
}