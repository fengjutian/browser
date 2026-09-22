import { useEffect, useState } from 'react'
import { applyDownloadUpdate, DOWNLOAD_FEED_LIMIT, normalizeDownloadPayload, type DownloadFeedEntry } from './downloadFeed'
import { onNativeDownload } from '../../services/nativeBrowser'

/**
 * Subscribe to the `browser://download` event bus and expose the merged feed.
 * The reducer and normaliser are pure helpers in `./downloadFeed`; this hook
 * is only glue. Pure logic is unit-tested separately.
 */
export function useDownloads(): { downloads: DownloadFeedEntry[]; clear: () => void } {
  const [downloads, setDownloads] = useState<DownloadFeedEntry[]>([])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void onNativeDownload(payload => {
      const normalized = normalizeDownloadPayload(payload)
      if (!normalized) return
      setDownloads(current => applyDownloadUpdate(current, normalized, DOWNLOAD_FEED_LIMIT))
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  return { downloads, clear: () => setDownloads([]) }
}