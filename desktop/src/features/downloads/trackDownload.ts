/**
 * Pure logic for the per-session "downloads" list — a log of Markdown exports
 * the user has triggered from the document detail drawer. Limited to the
 * most recent entries so the panel stays scannable.
 */
export interface DownloadEntry {
  documentId: string
  title: string
  exportedAt: number
}

export const DOWNLOAD_LIMIT = 50

export function trackDownload(entries: DownloadEntry[], next: DownloadEntry, limit = DOWNLOAD_LIMIT): DownloadEntry[] {
  if (!next.documentId) return entries
  return [{ ...next }, ...entries].slice(0, limit)
}

export function parseDownloads(raw: string | null | undefined): DownloadEntry[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    return value
      .filter((entry): entry is DownloadEntry =>
        !!entry && typeof entry === 'object'
        && typeof (entry as DownloadEntry).documentId === 'string'
        && typeof (entry as DownloadEntry).title === 'string'
        && typeof (entry as DownloadEntry).exportedAt === 'number',
      )
      .slice(0, DOWNLOAD_LIMIT)
  } catch {
    return []
  }
}