import { useCallback, useEffect, useRef, useState } from 'react'
import { listDownloads, removeDownloadRecord, showDownloadInFolder, openDownloadFile, cancelDownload, pauseDownload, retryDownload, type DownloadRecord } from '../../services/downloads'
import { applyDownloadUpdate, DOWNLOAD_FEED_LIMIT, normalizeDownloadPayload, type DownloadFeedEntry } from './downloadFeed'
import { onNativeDownload } from '../../services/nativeBrowser'

export interface UseDownloadCenterOptions {
  /** Whether to include records flagged `private: true` in the persistent list. */
  includePrivate?: boolean
  /** Fired once per terminal v2 event (finished / failed / cancelled). */
  onTerminal?: (entry: DownloadFeedEntry) => void
}

export interface UseDownloadCenterResult {
  records: DownloadRecord[]
  /** Hydrated flag — true after the initial list query resolves. */
  hydrated: boolean
  /** In-memory feed of recent v2 events for the toolbar summary. */
  feed: DownloadFeedEntry[]
  /** Force a re-fetch from SQLite. */
  refresh: () => Promise<void>
  remove: (id: string, deleteFile?: boolean) => Promise<void>
  open: (id: string) => Promise<void>
  reveal: (id: string) => Promise<void>
  pause: (id: string) => Promise<void>
  cancel: (id: string) => Promise<void>
  retry: (id: string) => Promise<string>
}

/**
 * Composes the persistent download database (via `download_list`) with the
 * live `browser://download` event feed. When a v2 event arrives we apply it
 * to the in-memory feed and trigger a debounced refresh of the DB so the
 * Library tab stays consistent without paying for an event-by-event DB
 * roundtrip.
 */
export function useDownloadCenter(options: UseDownloadCenterOptions = {}): UseDownloadCenterResult {
  const { includePrivate = false, onTerminal } = options
  const [records, setRecords] = useState<DownloadRecord[]>([])
  const [feed, setFeed] = useState<DownloadFeedEntry[]>([])
  const [hydrated, setHydrated] = useState(false)
  const refreshTimer = useRef<number | undefined>(undefined)
  const seenTerminalRef = useRef(new Set<string>())
  const onTerminalRef = useRef(onTerminal)
  onTerminalRef.current = onTerminal

  const refresh = useCallback(async () => {
    try {
      const list = await listDownloads(includePrivate)
      setRecords(list)
      setHydrated(true)
    } catch {
      // Surface the hydration status even when the call fails so the UI can
      // show the empty state instead of an infinite skeleton.
      setHydrated(true)
    }
  }, [includePrivate])

  // Initial fetch.
  useEffect(() => { void refresh() }, [refresh])

  // Subscribe to live events.
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void onNativeDownload(payload => {
      const normalized = normalizeDownloadPayload(payload)
      if (!normalized) return
      // Private downloads never reach the database; only the live feed
      // sees them for the duration of the in-memory transfer.
      if (normalized.private) return
      setFeed(current => applyDownloadUpdate(current, normalized, DOWNLOAD_FEED_LIMIT))
      if (
        (normalized.kind === 'finished' || normalized.kind === 'failed' || normalized.kind === 'cancelled')
        && normalized.id
      ) {
        const terminalKey = `${normalized.kind}:${normalized.id}`
        if (!seenTerminalRef.current.has(terminalKey)) {
          seenTerminalRef.current.add(terminalKey)
          onTerminalRef.current?.(normalized)
        }
        // Debounced re-fetch so the persistent list catches up.
        if (refreshTimer.current !== undefined) window.clearTimeout(refreshTimer.current)
        refreshTimer.current = window.setTimeout(() => { void refresh() }, 250)
      }
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => {
      disposed = true
      unlisten?.()
      if (refreshTimer.current !== undefined) window.clearTimeout(refreshTimer.current)
    }
  }, [refresh])

  const remove = useCallback(async (id: string, deleteFile = false) => {
    await removeDownloadRecord(id, deleteFile)
    await refresh()
  }, [refresh])

  const open = useCallback(async (id: string) => {
    await openDownloadFile(id)
  }, [])

  const reveal = useCallback(async (id: string) => {
    await showDownloadInFolder(id)
  }, [])

  const pause = useCallback(async (id: string) => {
    try {
      await pauseDownload(id)
    } finally {
      await refresh()
    }
  }, [refresh])

  const cancel = useCallback(async (id: string) => {
    try {
      await cancelDownload(id)
    } finally {
      await refresh()
    }
  }, [refresh])

  const retry = useCallback(async (id: string) => {
    try {
      return await retryDownload(id)
    } finally {
      await refresh()
    }
  }, [refresh])

  return { records, hydrated, feed, remove, open, reveal, pause, cancel, refresh, retry }
}