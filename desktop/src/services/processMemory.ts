import { invoke } from '@tauri-apps/api/core'

/**
 * Process memory snapshot returned by the `browser_process_memory` command.
 * Mirrors the Rust struct in `src-tauri/src/process_memory.rs`.
 */
export interface ProcessMemorySnapshot {
  /** Working-set (resident) size in bytes. */
  workingSetBytes: number
  /** Peak working-set size in bytes since process start. */
  peakWorkingSetBytes: number
  /** Committed / pagefile usage in bytes. */
  commitBytes: number
  /** Cumulative page-fault count since process start. */
  pageFaultCount: number
}

const isTauri = () => '__TAURI_INTERNALS__' in window

/**
 * Snapshot the current process memory accounting from the Rust side.
 *
 * Returns `null` outside Tauri or when the host platform does not yet
 * implement the query (the frontend renders an em-dash in that case).
 */
export async function readProcessMemory(): Promise<ProcessMemorySnapshot | null> {
  if (!isTauri()) return null
  try {
    return await invoke<ProcessMemorySnapshot | null>('browser_process_memory')
  } catch {
    return null
  }
}

/** Human-friendly byte size with adaptive units. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const fixed = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)
  return `${fixed} ${units[unitIndex]}`
}