import { describe, expect, it, beforeAll } from 'vitest'
import {
  decryptPrivacyPayload,
  encryptPrivacyPayload,
  exportStats,
  mergeBookmarks,
  mergeHistory,
  normaliseSections,
  type PrivacyExportSections,
} from './privacyExport'

const SAMPLE: PrivacyExportSections = {
  history: [
    { url: 'https://a.com', title: 'A', visitedAt: 1 },
    { url: 'https://b.com', title: 'B', visitedAt: 2 },
  ],
  closedTabs: [{ id: 'ct-1', url: 'https://x.com', title: 'X', closedAt: 1 }],
  bookmarks: [{ id: 'bm-1', url: 'https://docs.example.com', title: 'Docs' }],
  downloads: [{ id: 'dl-1', url: 'https://example.com/file.zip', fileName: 'file.zip', status: 'completed', startedAt: '2024-01-01T00:00:00Z' }],
  searchEngine: { presetId: 'duckduckgo' },
  sitePermissions: [{ origin: 'https://a.com', camera: 'deny' }],
}

beforeAll(() => {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
    Object.defineProperty(globalThis, 'crypto', {
      value: { subtle: undefined, getRandomValues: undefined },
      configurable: true,
    })
  }
})

describe('normaliseSections', () => {
  it('drops entries with missing fields', () => {
    const result = normaliseSections({
      history: [
        { url: 'https://a.com', title: 'A', visitedAt: 1 },
        { url: 42 as unknown as string, title: 'X', visitedAt: 1 },
        { url: 'https://b.com', title: 7 as unknown as string, visitedAt: 1 },
      ],
      closedTabs: [],
      bookmarks: [],
      downloads: [],
    })
    expect(result.history.length).toBe(1)
  })

  it('always returns a fully populated shape', () => {
    const result = normaliseSections({} as PrivacyExportSections)
    expect(result.history).toEqual([])
    expect(result.closedTabs).toEqual([])
    expect(result.bookmarks).toEqual([])
    expect(result.downloads).toEqual([])
  })
})

describe('mergeHistory', () => {
  it('skips duplicates when requested', () => {
    const existing = [{ url: 'https://a.com', title: 'A', visitedAt: 1 }]
    const incoming = [{ url: 'https://a.com', title: 'A2', visitedAt: 2 }, { url: 'https://b.com', title: 'B', visitedAt: 3 }]
    const merged = mergeHistory(existing, incoming)
    expect(merged.length).toBe(2)
    expect(merged[0].url).toBe('https://b.com')
  })

  it('adds incoming even when skipExisting is false', () => {
    const existing = [{ url: 'https://a.com', title: 'A', visitedAt: 1 }]
    const incoming = [{ url: 'https://a.com', title: 'A2', visitedAt: 2 }]
    const merged = mergeHistory(existing, incoming, { skipExisting: false })
    expect(merged.length).toBe(2)
  })
})

describe('mergeBookmarks', () => {
  it('replaces ids with random uuid when missing', () => {
    const merged = mergeBookmarks([], [{ id: '', url: 'https://x.com', title: 'X' }])
    expect(merged[0].id.length).toBeGreaterThan(8)
  })

  it('skips URL collision', () => {
    const merged = mergeBookmarks(
      [{ id: 'a', url: 'https://x.com', title: 'X' }],
      [{ id: 'b', url: 'https://x.com', title: 'X2' }],
    )
    expect(merged.length).toBe(1)
  })
})

describe('exportStats', () => {
  it('returns counts plus byte length', () => {
    const stats = exportStats(SAMPLE)
    expect(stats.history).toBe(2)
    expect(stats.bookmarks).toBe(1)
    expect(stats.downloads).toBe(1)
    expect(stats.bytes).toBeGreaterThan(100)
  })
})

describe('encryptPrivacyPayload + decryptPrivacyPayload', () => {
  it('round-trips with the same password', async () => {
    if (!globalThis.crypto?.subtle) {
      // happy-dom might not expose subtle in older versions — guard the test.
      return
    }
    const envelope = await encryptPrivacyPayload(SAMPLE, 'hunter2')
    expect(envelope.format).toBe('arcadia-privacy-export')
    expect(envelope.cipher).toBe('AES-GCM')
    const decrypted = await decryptPrivacyPayload(envelope, 'hunter2')
    expect(decrypted).toEqual(SAMPLE)
  })

  it('rejects a wrong password', async () => {
    if (!globalThis.crypto?.subtle) return
    const envelope = await encryptPrivacyPayload(SAMPLE, 'hunter2')
    await expect(decryptPrivacyPayload(envelope, 'wrong-pw')).rejects.toBeTruthy()
  })
})