import { useCallback, useEffect, useRef, useState } from 'react'
import { applyDownloadUpdate, DOWNLOAD_FEED_LIMIT, normalizeDownloadPayload, type DownloadFeedEntry } from './downloadFeed'
import { onNativeDownload } from '../../services/nativeBrowser'

export interface UseDownloadsOptions {
  /** Optional callback fired once per terminal (completed/failed) update. */
  onTerminal?: (entry: DownloadFeedEntry) => void
}

export interface UseDownloadsResult {
  /** Latest-first list of {@link DownloadFeedEntry} with at most {@link DOWNLOAD_FEED_LIMIT} items. */
  downloads: DownloadFeedEntry[]
  /** Drop the whole feed (e.g. toolbar "clear" button). */
  clear: () => void
  /** Drop a single entry by URL. */
  remove: (url: string) => void
}

/**
 * Subscribe to the `browser://download` event bus, normalise payloads to the
 * v1 contract, dedupe by URL, and optionally fire a callback once per
 * completed/failed transition. The reducer and normaliser are pure helpers in
 * `./downloadFeed`; this hook is glue and delegates the dedupe math there.
 *
 * Event payload versioning: missing `version` is treated as v1 (current); a
 * higher version is accepted but the frontend only reads v1 fields today.
 */
export function useDownloads(options: UseDownloadsOptions = {}): UseDownloadsResult {
  const { onTerminal } = options
  const [downloads, setDownloads] = useState<DownloadFeedEntry[]>([])
  const onTerminalRef = useRef(onTerminal)
  onTerminalRef.current = onTerminal
  const lastTerminalRef = useRef(new Set<string>())

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void onNativeDownload(payload => {
      const normalized = normalizeDownloadPayload(payload)
      if (!normalized) return
      setDownloads(current => applyDownloadUpdate(current, normalized, DOWNLOAD_FEED_LIMIT))
      if (normalized.status === 'completed' || normalized.status === 'failed') {
        const key = `${normalized.status}:${normalized.url}`
        if (!lastTerminalRef.current.has(key)) {
          lastTerminalRef.current.add(key)
          onTerminalRef.current?.(normalized)
        }
      }
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const clear = useCallback(() => {
    setDownloads([])
    lastTerminalRef.current.clear()
  }, [])

  const remove = useCallback((url: string) => {
    setDownloads(current => current.filter(item => item.url !== url))
    lastTerminalRef.current.forEach(key => { if (key.endsWith(`:${url}`)) lastTerminalRef.current.delete(key) })
  }, [])

  return { downloads, clear, remove }
}