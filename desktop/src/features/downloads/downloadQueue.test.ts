import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  dequeueDownload,
  DOWNLOAD_QUEUE_EVENT,
  enqueueDownload,
  formatQueuedAge,
  moveQueuedDownload,
  nextReadyFromQueue,
  queuedAgeMs,
  readDownloadQueue,
  writeDownloadQueue,
  type QueuedDownload,
} from './downloadQueue'

function make(overrides: Partial<QueuedDownload> = {}): QueuedDownload {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    url: overrides.url ?? 'https://example.com/file.bin',
    fileName: overrides.fileName ?? 'file.bin',
    mimeType: overrides.mimeType,
    sourceOrigin: overrides.sourceOrigin,
    sourceTabLabel: overrides.sourceTabLabel,
    dangerType: overrides.dangerType,
    enqueuedAt: overrides.enqueuedAt ?? Date.now(),
  }
}

describe('downloadQueue', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('round-trips through localStorage', () => {
    const entry = make({ id: 'a' })
    writeDownloadQueue([entry])
    expect(readDownloadQueue()).toEqual([entry])
  })

  it('enqueue appends to the back and dedupes by id/url', () => {
    enqueueDownload(make({ id: 'a', url: 'u1' }))
    enqueueDownload(make({ id: 'b', url: 'u2' }))
    enqueueDownload(make({ id: 'a', url: 'u1' }))
    expect(readDownloadQueue().map(item => item.id)).toEqual(['a', 'b'])
  })

  it('dequeue removes by id', () => {
    enqueueDownload(make({ id: 'a', url: 'u1' }))
    enqueueDownload(make({ id: 'b', url: 'u2' }))
    dequeueDownload('a')
    expect(readDownloadQueue().map(item => item.id)).toEqual(['b'])
  })

  it('dispatches DOWNLOAD_QUEUE_EVENT on writes', () => {
    const seen: QueuedDownload[][] = []
    const handler = (event: Event) => seen.push((event as CustomEvent<QueuedDownload[]>).detail)
    window.addEventListener(DOWNLOAD_QUEUE_EVENT, handler)
    try {
      enqueueDownload(make({ id: 'a', url: 'u1' }))
      enqueueDownload(make({ id: 'b', url: 'u2' }))
      expect(seen.length).toBe(2)
      expect(seen.at(-1)?.map(item => item.id)).toEqual(['a', 'b'])
    } finally {
      window.removeEventListener(DOWNLOAD_QUEUE_EVENT, handler)
    }
  })

  it('nextReadyFromQueue caps by max - running', () => {
    const items = [make({ id: 'a' }), make({ id: 'b' }), make({ id: 'c' }), make({ id: 'd' })]
    expect(nextReadyFromQueue(1, 3, items).map(item => item.id)).toEqual(['a', 'b'])
    expect(nextReadyFromQueue(4, 3, items)).toEqual([])
    expect(nextReadyFromQueue(0, 0, items)).toEqual([])
  })

  it('moveQueuedDownload swaps adjacent entries', () => {
    const items = [make({ id: 'a' }), make({ id: 'b' }), make({ id: 'c' })]
    writeDownloadQueue(items)
    moveQueuedDownload('a', 'down')
    expect(readDownloadQueue().map(item => item.id)).toEqual(['b', 'a', 'c'])
    moveQueuedDownload('c', 'up')
    expect(readDownloadQueue().map(item => item.id)).toEqual(['b', 'c', 'a'])
  })

  it('drops malformed entries on read', () => {
    localStorage.setItem('arcadia-download-queue.v1', '[{"id":"good","url":"u","fileName":"f","enqueuedAt":1},{"junk":true}]')
    const items = readDownloadQueue()
    expect(items.length).toBe(1)
    expect(items[0].id).toBe('good')
  })

  it('formatQueuedAge scales seconds → minutes → hours', () => {
    const now = 1_700_000_000_000
    expect(formatQueuedAge(make({ enqueuedAt: now }), now)).toBe('刚刚')
    expect(formatQueuedAge(make({ enqueuedAt: now - 3_500 }), now)).toBe('3 秒')
    expect(formatQueuedAge(make({ enqueuedAt: now - 65_000 }), now)).toBe('1 分')
    expect(formatQueuedAge(make({ enqueuedAt: now - 3_600_000 }), now)).toBe('1 小时')
    expect(queuedAgeMs(make({ enqueuedAt: now - 100 }), now)).toBe(100)
  })
})