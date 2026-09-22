import { describe, expect, it } from 'vitest'
import { parseDownloads, trackDownload, type DownloadEntry } from './trackDownload'

const entry = (id: string, title = id, exportedAt = 0): DownloadEntry => ({ documentId: id, title, exportedAt })

describe('trackDownload', () => {
  it('prepends a new entry', () => {
    expect(trackDownload([entry('a'), entry('b')], entry('c', 'C', 5))).toEqual([
      entry('c', 'C', 5),
      entry('a'),
      entry('b'),
    ])
  })

  it('caps the list at the provided limit', () => {
    const seed = Array.from({ length: 50 }, (_, i) => entry(`id-${i}`))
    const result = trackDownload(seed, entry('new', 'New', 0), 50)
    expect(result).toHaveLength(50)
    expect(result[0].documentId).toBe('new')
  })

  it('drops empty documentId entries', () => {
    expect(trackDownload([entry('a')], entry('', '', 5))).toEqual([entry('a')])
  })
})

describe('parseDownloads', () => {
  it('returns [] for null / empty / non-JSON', () => {
    expect(parseDownloads(null)).toEqual([])
    expect(parseDownloads('')).toEqual([])
    expect(parseDownloads('garbage')).toEqual([])
  })

  it('returns [] when payload is not an array', () => {
    expect(parseDownloads('{}')).toEqual([])
  })

  it('drops malformed entries', () => {
    const raw = JSON.stringify([
      entry('a', 'A', 1),
      { documentId: 42, title: 'X', exportedAt: 1 },
      null,
      'string',
    ])
    expect(parseDownloads(raw)).toEqual([entry('a', 'A', 1)])
  })

  it('caps parsed list at DOWNLOAD_LIMIT', () => {
    const seed = Array.from({ length: 80 }, (_, i) => entry(`id-${i}`))
    expect(parseDownloads(JSON.stringify(seed))).toHaveLength(50)
  })
})