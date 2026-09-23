/**
 * Pure FIFO queue of pending downloads that should only start once a running
 * slot frees up. The queue lives in localStorage so a refresh or a crash
 * never silently drops a user-initiated download.
 *
 * The cap is enforced by `useDownloadQueue` — when `running` is below
 * `maxConcurrent`, the next queued entry is dispatched to the Rust
 * `download_start_reqwest` command and removed from this list. Entries that
 * already have a Rust `id` are deduped so a double-click on "save image"
 * cannot enqueue the same URL twice.
 */

const STORAGE_KEY = 'arcadia-download-queue.v1'
export const DOWNLOAD_QUEUE_EVENT = 'arcadia-download-queue-change'

export interface QueuedDownload {
  /** Frontend-generated id; re-used as the Rust `id` once promoted. */
  id: string
  url: string
  fileName: string
  mimeType?: string
  sourceOrigin?: string
  sourceTabLabel?: string
  dangerType?: 'none' | 'executable' | 'script' | 'archive' | 'document' | 'other'
  /** ms epoch when the entry was enqueued — used to display "排队 N 秒". */
  enqueuedAt: number
}

function isQueuedDownload(value: unknown): value is QueuedDownload {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.url === 'string' && typeof v.fileName === 'string' && typeof v.enqueuedAt === 'number'
}

export function readDownloadQueue(): QueuedDownload[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isQueuedDownload)
  } catch {
    return []
  }
}

export function writeDownloadQueue(items: QueuedDownload[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<QueuedDownload[]>(DOWNLOAD_QUEUE_EVENT, { detail: items }))
  }
}

/** Append a new download to the back of the queue (no-op if same id exists). */
export function enqueueDownload(entry: QueuedDownload): QueuedDownload[] {
  const items = readDownloadQueue()
  if (items.some(item => item.id === entry.id || item.url === entry.url)) return items
  const next = [...items, entry]
  writeDownloadQueue(next)
  return next
}

/** Remove the entry whose id matches; returns the resulting queue. */
export function dequeueDownload(id: string): QueuedDownload[] {
  const next = readDownloadQueue().filter(item => item.id !== id)
  writeDownloadQueue(next)
  return next
}

/** Re-order a queued entry by id (used for drag-to-reorder later). */
export function moveQueuedDownload(id: string, direction: 'up' | 'down'): QueuedDownload[] {
  const items = readDownloadQueue()
  const i = items.findIndex(item => item.id === id)
  if (i < 0) return items
  const swap = direction === 'up' ? i - 1 : i + 1
  if (swap < 0 || swap >= items.length) return items
  const copy = items.slice()
  ;[copy[i], copy[swap]] = [copy[swap], copy[i]]
  writeDownloadQueue(copy)
  return copy
}

/**
 * Compute how many additional downloads can start right now. Returns the
 * head-of-queue entries the caller should dispatch, in order. If `max` is
 * smaller than `running`, returns an empty array (nothing to do).
 */
export function nextReadyFromQueue(running: number, max: number, items: QueuedDownload[] = readDownloadQueue()): QueuedDownload[] {
  if (max < 1) return []
  const slots = Math.max(0, max - running)
  if (slots <= 0) return []
  return items.slice(0, slots)
}

/** Time in ms since the entry was first enqueued; capped at 24h to avoid overflow. */
export function queuedAgeMs(entry: QueuedDownload, now = Date.now()): number {
  return Math.max(0, Math.min(now - entry.enqueuedAt, 24 * 60 * 60 * 1000))
}

/** Human-friendly wait time, e.g. "3 秒" / "2 分" / "1 小时". */
export function formatQueuedAge(entry: QueuedDownload, now: number = Date.now()): string {
  const ms = queuedAgeMs(entry, now)
  if (ms < 1000) return '刚刚'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec} 秒`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分`
  const hr = Math.floor(min / 60)
  return `${hr} 小时`
}