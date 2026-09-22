/**
 * Pure reducer for the live download feed shown in the browser toolbar.
 *
 * The feed accepts v1 (`url` + `tabLabel` + `path` + `status`) and v2
 * (`id` + `kind` + `targetPath` + byte progress + danger type + private
 * flag) payloads. v2 is the canonical contract going forward; v1 still
 * arrives when a third-party listener forgets to upgrade.
 *
 * WebView-native downloads only emit Requested / Finished events through
 * Tauri 2, so byte-level progress is `progressKnown: false` until reqwest
 * streaming lands in batch 1 sub-batch B. We surface "indeterminate" in the
 * UI rather than fake the percentage.
 */
export type DownloadStatus =
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused'
  | 'queued'
  | 'blocked'

export interface DownloadFeedEntry {
  id?: string
  url: string
  tabLabel: string
  fileName?: string
  /** v2 field — preferred over `path`. */
  targetPath?: string
  /** v1 legacy alias — accepted but `targetPath` wins. */
  path?: string
  status: DownloadStatus
  version?: number
  /** v2 fields. */
  receivedBytes?: number
  totalBytes?: number
  progressKnown?: boolean
  dangerType?: 'none' | 'executable' | 'script' | 'archive' | 'document' | 'other'
  errorMessage?: string
  private?: boolean
  sourceOrigin?: string
  kind?: 'started' | 'progress' | 'finished' | 'failed' | 'cancelled' | 'blocked'
}

export const DOWNLOAD_FEED_LIMIT = 30
export const DOWNLOAD_PAYLOAD_VERSION = 2

const keyFor = (entry: Pick<DownloadFeedEntry, 'id' | 'url'>): string =>
  entry.id ? `id:${entry.id}` : `url:${entry.url}`

/**
 * Dedupe reducer used by the useDownloads hook. Dedupe key prefers the
 * server-issued `id`; falls back to `url` so v1 payloads still merge
 * correctly. Returns a new array (never mutates input) so React state updates
 * stay referentially distinct.
 */
export function applyDownloadUpdate(
  entries: readonly DownloadFeedEntry[],
  next: DownloadFeedEntry,
  limit = DOWNLOAD_FEED_LIMIT,
): DownloadFeedEntry[] {
  const nextKey = keyFor(next)
  const index = entries.findIndex(item => keyFor(item) === nextKey)
  const merged: DownloadFeedEntry = {
    ...next,
    targetPath: next.targetPath ?? next.path,
    version: next.version ?? DOWNLOAD_PAYLOAD_VERSION,
  }
  if (index < 0) return [merged, ...entries].slice(0, limit)
  const copy = entries.slice()
  copy[index] = { ...copy[index], ...merged }
  return copy
}

/**
 * Lightweight payload normaliser used by useDownloads and tests to validate
 * arbitrary input shapes from the event bus. Unknown versions are accepted as
 * `DOWNLOAD_PAYLOAD_VERSION` so newer payloads don't break the toolbar.
 */
export function normalizeDownloadPayload(input: unknown): DownloadFeedEntry | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  if (typeof value.url !== 'string' || typeof value.tabLabel !== 'string') return null
  const status = value.status
  if (!isDownloadStatus(status)) return null
  const kind = value.kind
  const danger = value.dangerType
  return {
    id: typeof value.id === 'string' ? value.id : undefined,
    url: value.url,
    tabLabel: value.tabLabel,
    fileName: typeof value.fileName === 'string' ? value.fileName : undefined,
    targetPath: typeof value.targetPath === 'string'
      ? value.targetPath
      : typeof value.path === 'string'
        ? value.path
        : undefined,
    path: typeof value.path === 'string' ? value.path : undefined,
    status,
    version: typeof value.version === 'number' ? value.version : DOWNLOAD_PAYLOAD_VERSION,
    receivedBytes: typeof value.receivedBytes === 'number' ? value.receivedBytes : undefined,
    totalBytes: typeof value.totalBytes === 'number' ? value.totalBytes : undefined,
    progressKnown: typeof value.progressKnown === 'boolean' ? value.progressKnown : undefined,
    dangerType: isDangerType(danger) ? danger : undefined,
    errorMessage: typeof value.errorMessage === 'string' ? value.errorMessage : undefined,
    private: typeof value.private === 'boolean' ? value.private : undefined,
    sourceOrigin: typeof value.sourceOrigin === 'string' ? value.sourceOrigin : undefined,
    kind: isKind(kind) ? kind : undefined,
  }
}

function isDownloadStatus(value: unknown): value is DownloadStatus {
  return (
    value === 'downloading' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'paused' ||
    value === 'queued' ||
    value === 'blocked'
  )
}

function isDangerType(value: unknown): value is NonNullable<DownloadFeedEntry['dangerType']> {
  return (
    value === 'none' ||
    value === 'executable' ||
    value === 'script' ||
    value === 'archive' ||
    value === 'document' ||
    value === 'other'
  )
}

function isKind(value: unknown): value is NonNullable<DownloadFeedEntry['kind']> {
  return (
    value === 'started' ||
    value === 'progress' ||
    value === 'finished' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'blocked'
  )
}

/**
 * Pretty filename for the toolbar list: derive from targetPath, fallback to
 * URL basename, fallback to URL itself.
 */
export function displayNameFor(entry: DownloadFeedEntry): string {
  const path = entry.targetPath ?? entry.path
  if (path) {
    const tail = path.split(/[\\/]/).pop()
    if (tail) return tail
  }
  if (entry.fileName) return entry.fileName
  try {
    const parsed = new URL(entry.url)
    const tail = parsed.pathname.split('/').pop()
    if (tail) return tail
  } catch {
    /* fall through */
  }
  return entry.url
}