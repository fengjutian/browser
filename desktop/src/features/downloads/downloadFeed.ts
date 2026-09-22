/**
 * Pure reducer for the live download feed shown in the browser toolbar. The
 * feed is best-effort: Tauri 2 only surfaces Requested / Finished for native
 * WebView downloads, so we cannot rely on byte-accurate progress and may only
 * see completed/failed. Newer payload revisions add `version` to allow
 * forward-compatible parsing; we accept payloads missing the field as v1.
 */
export type DownloadStatus = 'downloading' | 'completed' | 'failed'

export interface DownloadFeedEntry {
  url: string
  tabLabel: string
  path?: string
  status: DownloadStatus
  version?: number
  receivedBytes?: number
  totalBytes?: number
  progressKnown?: boolean
  errorMessage?: string
}

export const DOWNLOAD_FEED_LIMIT = 30
export const DOWNLOAD_PAYLOAD_VERSION = 1

/**
 * Dedupe-by-URL reducer used by the useDownloads hook. Unknown versions are
 * accepted so future payloads do not break the toolbar. Returns a new array
 * (never mutates input) so React state updates stay referentially distinct.
 */
export function applyDownloadUpdate(
  entries: readonly DownloadFeedEntry[],
  next: DownloadFeedEntry,
  limit = DOWNLOAD_FEED_LIMIT,
): DownloadFeedEntry[] {
  const index = entries.findIndex(item => item.url === next.url)
  const merged: DownloadFeedEntry = { ...next, version: next.version ?? DOWNLOAD_PAYLOAD_VERSION }
  if (index < 0) return [merged, ...entries].slice(0, limit)
  const copy = entries.slice()
  copy[index] = { ...copy[index], ...merged }
  return copy
}

/**
 * Lightweight payload normaliser used by useDownloads and tests to validate
 * arbitrary input shapes from the event bus. Unknown versions are accepted as
 * DOWNLOAD_PAYLOAD_VERSION so newer payloads don't break the toolbar.
 */
export function normalizeDownloadPayload(input: unknown): DownloadFeedEntry | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  if (typeof value.url !== 'string' || typeof value.tabLabel !== 'string') return null
  const status = value.status
  if (status !== 'downloading' && status !== 'completed' && status !== 'failed') return null
  return {
    url: value.url,
    tabLabel: value.tabLabel,
    path: typeof value.path === 'string' ? value.path : undefined,
    status,
    version: typeof value.version === 'number' ? value.version : DOWNLOAD_PAYLOAD_VERSION,
  }
}