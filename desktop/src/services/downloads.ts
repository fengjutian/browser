import { invoke } from '@tauri-apps/api/core'

/**
 * Mirrors the Rust `DownloadStatus` enum. The string values match the SQLite
 * `status` column so the type can be passed straight through.
 */
export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'blocked'

export type DangerType =
  | 'none'
  | 'executable'
  | 'script'
  | 'archive'
  | 'document'
  | 'other'

/**
 * Shape returned by `download_list` and `download_get`. Mirrors the Rust
 * `DownloadRecord` struct field-for-field after serde camelCasing.
 */
export interface DownloadRecord {
  id: string
  url: string
  fileName: string
  targetPath: string | null
  mimeType: string | null
  receivedBytes: number
  totalBytes: number | null
  status: DownloadStatus
  dangerType: DangerType
  errorMessage: string | null
  sourceOrigin: string | null
  sourceTabLabel: string | null
  private: boolean
  startedAt: string
  updatedAt: string
  finishedAt: string | null
}

const isTauri = () => '__TAURI_INTERNALS__' in window

const FALLBACK: DownloadRecord[] = []

export async function listDownloads(includePrivate = false): Promise<DownloadRecord[]> {
  if (!isTauri()) return FALLBACK
  return invoke<DownloadRecord[]>('download_list', { includePrivate })
}

export async function getDownload(id: string): Promise<DownloadRecord | null> {
  if (!isTauri()) return null
  return invoke<DownloadRecord | null>('download_get', { id })
}

export async function removeDownloadRecord(id: string, deleteFile = false): Promise<void> {
  if (!isTauri()) return
  await invoke('download_remove_record', { id, deleteFile })
}

export async function openDownloadFile(id: string): Promise<void> {
  if (!isTauri()) return
  await invoke('download_open_file', { id })
}

export async function showDownloadInFolder(id: string): Promise<void> {
  if (!isTauri()) return
  await invoke('download_show_in_folder', { id })
}

/**
 * Display-friendly file name. Prefers the database's `fileName` column
 * (which we set from WebView's destination basename) but falls back to the
 * URL pathname so a missing DB field still shows something sensible.
 */
export function fileNameOf(record: DownloadRecord | { url: string; fileName?: string; targetPath?: string | null }): string {
  if ('fileName' in record && record.fileName) return record.fileName
  if ('targetPath' in record && record.targetPath) {
    const tail = record.targetPath.split(/[\\/]/).pop()
    if (tail) return tail
  }
  try {
    const parsed = new URL(record.url)
    const tail = parsed.pathname.split('/').pop()
    if (tail) return tail
  } catch {
    /* fall through */
  }
  return record.url
}