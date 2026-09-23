import { useCallback, useEffect, useRef, useState } from 'react'
import {
  dequeueDownload,
  DOWNLOAD_QUEUE_EVENT,
  enqueueDownload,
  nextReadyFromQueue,
  readDownloadQueue,
  type QueuedDownload,
} from './downloadQueue'
import { readAdvancedSettings, ADVANCED_SETTINGS_EVENT } from '../settings/advanced'
import { startDownload } from '../../services/downloads'
import type { DownloadFeedEntry } from './downloadFeed'

export interface UseDownloadQueueOptions {
  /** Live list of currently running downloads (status === 'downloading'). */
  runningDownloads: DownloadFeedEntry[]
  /** Optional override for the cap; defaults to advanced settings. */
  maxConcurrent?: number
}

export interface UseDownloadQueueResult {
  /** Pending items that have not been dispatched yet. */
  pending: QueuedDownload[]
  /** Current concurrency cap. */
  maxConcurrent: number
  /** Append a download to the queue (or start it immediately if a slot is free). */
  submit: (entry: Omit<QueuedDownload, 'enqueuedAt'>) => Promise<{ queued: boolean; dispatched: boolean }>
  /** Manually remove a queued entry. */
  remove: (id: string) => void
  /** Live count of running downloads derived from the bus. */
  running: number
}

/**
 * Reactive bridge between the {@link useDownloads} bus and the FIFO queue.
 *
 * The hook exposes a `submit` helper that either dispatches a download
 * immediately (when running < max) or pushes it to the queue. Whenever a
 * download transitions to a terminal state the bus callback below decrements
 * the running count and triggers another promotion pass, so queued items
 * naturally take the next free slot.
 */
export function useDownloadQueue({ runningDownloads, maxConcurrent }: UseDownloadQueueOptions = { runningDownloads: [] }): UseDownloadQueueResult {
  const [pending, setPending] = useState<QueuedDownload[]>(() => readDownloadQueue())
  const [cap, setCap] = useState<number>(() => maxConcurrent ?? readAdvancedSettings().maxConcurrentDownloads)
  const promotingRef = useRef(false)
  const runningRef = useRef<number>(0)
  runningRef.current = runningDownloads.filter(item => item.status === 'downloading' || item.status === 'paused').length

  useEffect(() => {
    function onQueue(event: Event) {
      const detail = (event as CustomEvent<QueuedDownload[]>).detail
      setPending(Array.isArray(detail) ? detail : readDownloadQueue())
    }
    function onSettings() {
      setCap(readAdvancedSettings().maxConcurrentDownloads)
    }
    window.addEventListener(DOWNLOAD_QUEUE_EVENT, onQueue)
    window.addEventListener(ADVANCED_SETTINGS_EVENT, onSettings)
    return () => {
      window.removeEventListener(DOWNLOAD_QUEUE_EVENT, onQueue)
      window.removeEventListener(ADVANCED_SETTINGS_EVENT, onSettings)
    }
  }, [])

  const promote = useCallback(async () => {
    if (promotingRef.current) return
    promotingRef.current = true
    try {
      const effectiveCap = maxConcurrent ?? cap
      let items = readDownloadQueue()
      while (items.length > 0) {
        const next = nextReadyFromQueue(runningRef.current, effectiveCap, items)
        if (next.length === 0) break
        const head = next[0]
        try {
          await startDownload({
            id: head.id,
            url: head.url,
            fileName: head.fileName,
            mimeType: head.mimeType,
            sourceOrigin: head.sourceOrigin,
            sourceTabLabel: head.sourceTabLabel,
            dangerType: head.dangerType,
          })
        } catch (error) {
          console.error('download queue: promotion failed', error)
        }
        // Always remove the head, even if startDownload threw — otherwise the
        // bad entry would block everything behind it forever.
        items = dequeueDownload(head.id)
        setPending(items)
      }
    } finally {
      promotingRef.current = false
    }
  }, [cap, maxConcurrent])

  // Whenever running count decreases (terminal event) OR cap changes, try to
  // promote the next item.
  useEffect(() => {
    void promote()
  }, [runningRef.current, cap, promote])

  const submit = useCallback(async (entry: Omit<QueuedDownload, 'enqueuedAt'>) => {
    const effectiveCap = maxConcurrent ?? cap
    const slots = Math.max(0, effectiveCap - runningRef.current)
    if (slots > 0) {
      try {
        await startDownload({ id: entry.id, url: entry.url, fileName: entry.fileName, mimeType: entry.mimeType, sourceOrigin: entry.sourceOrigin, sourceTabLabel: entry.sourceTabLabel, dangerType: entry.dangerType })
        return { queued: false, dispatched: true }
      } catch (error) {
        console.error('download queue: dispatch failed, falling back to enqueue', error)
      }
    }
    const next = enqueueDownload({ ...entry, enqueuedAt: Date.now() })
    setPending(next)
    return { queued: true, dispatched: false }
  }, [cap, maxConcurrent])

  const remove = useCallback((id: string) => {
    const next = dequeueDownload(id)
    setPending(next)
  }, [])

  return { pending, maxConcurrent: cap, submit, remove, running: runningRef.current }
}