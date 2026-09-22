import { describe, expect, it } from 'vitest'
import { applyDownloadUpdate, DOWNLOAD_PAYLOAD_VERSION, normalizeDownloadPayload, type DownloadFeedEntry } from './downloadFeed'

const entry = (overrides: Partial<DownloadFeedEntry> = {}): DownloadFeedEntry => ({
  url: 'https://example.com/a.zip',
  tabLabel: 'browser-tab-1',
  status: 'downloading',
  ...overrides,
})

describe('applyDownloadUpdate', () => {
  it('prepends new entries when the URL is unknown', () => {
    const result = applyDownloadUpdate([entry({ url: 'https://example.com/old' })], entry({ url: 'https://example.com/new' }))
    expect(result.map(item => item.url)).toEqual(['https://example.com/new', 'https://example.com/old'])
  })

  it('merges by URL when the URL already exists', () => {
    const result = applyDownloadUpdate([entry({ url: 'https://example.com/a' })], entry({ url: 'https://example.com/a', status: 'completed', path: '/tmp/a.zip' }))
    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('completed')
    expect(result[0].path).toBe('/tmp/a.zip')
  })

  it('caps the feed at the limit', () => {
    const seed = Array.from({ length: 30 }, (_, i) => entry({ url: `https://example.com/${i}` }))
    const result = applyDownloadUpdate(seed, entry({ url: 'https://example.com/brand-new' }), 30)
    expect(result).toHaveLength(30)
    expect(result[0].url).toBe('https://example.com/brand-new')
  })

  it('defaults the payload version to the current contract version', () => {
    const result = applyDownloadUpdate([], entry())
    expect(result[0].version).toBe(DOWNLOAD_PAYLOAD_VERSION)
  })

  it('preserves a higher payload version (does not downgrade)', () => {
    const result = applyDownloadUpdate([], entry({ version: 7 }))
    expect(result[0].version).toBe(7)
  })
})

describe('normalizeDownloadPayload', () => {
  it('accepts the minimal v2 payload from Tauri', () => {
    expect(normalizeDownloadPayload({
      url: 'https://e/x',
      tabLabel: 'browser-1',
      status: 'downloading',
      id: 'dl-1',
      kind: 'started',
    })).toEqual({
      id: 'dl-1',
      url: 'https://e/x',
      tabLabel: 'browser-1',
      fileName: undefined,
      targetPath: undefined,
      path: undefined,
      status: 'downloading',
      version: DOWNLOAD_PAYLOAD_VERSION,
      receivedBytes: undefined,
      totalBytes: undefined,
      progressKnown: undefined,
      dangerType: undefined,
      errorMessage: undefined,
      private: undefined,
      sourceOrigin: undefined,
      kind: 'started',
    })
  })

  it('keeps the explicit version when provided', () => {
    expect(normalizeDownloadPayload({ url: 'a', tabLabel: 'b', status: 'completed', version: 2 })?.version).toBe(2)
  })

  it('accepts the queued status (v2 extension)', () => {
    const result = normalizeDownloadPayload({ url: 'a', tabLabel: 'b', status: 'queued' })
    expect(result?.status).toBe('queued')
  })

  it('drops payloads with unknown status', () => {
    expect(normalizeDownloadPayload({ url: 'a', tabLabel: 'b', status: 'garbage' })).toBeNull()
  })

  it('drops payloads missing url or tabLabel', () => {
    expect(normalizeDownloadPayload({ tabLabel: 'b', status: 'downloading' })).toBeNull()
    expect(normalizeDownloadPayload({ url: 'a', status: 'downloading' })).toBeNull()
  })

  it('drops non-object payloads', () => {
    expect(normalizeDownloadPayload('garbage')).toBeNull()
    expect(normalizeDownloadPayload(null)).toBeNull()
  })

  it('maps v1 path to targetPath', () => {
    const result = normalizeDownloadPayload({ url: 'a', tabLabel: 'b', status: 'completed', path: '/tmp/a.zip' })
    expect(result?.targetPath).toBe('/tmp/a.zip')
  })
})

describe('applyDownloadUpdate dedupe', () => {
  it('prefers id over url for dedupe when both are present', () => {
    const seed = [entry({ id: 'dl-1', url: 'https://example.com/a' })]
    const result = applyDownloadUpdate(seed, entry({ id: 'dl-1', url: 'https://example.com/a', status: 'completed' }))
    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('completed')
  })

  it('keeps two distinct ids of the same url as separate entries', () => {
    const seed = [entry({ id: 'dl-1', url: 'https://example.com/a' })]
    const result = applyDownloadUpdate(seed, entry({ id: 'dl-2', url: 'https://example.com/a' }))
    expect(result).toHaveLength(2)
  })
})