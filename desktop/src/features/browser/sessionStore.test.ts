import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  emptySnapshot,
  readLatestSnapshot,
  restoreFromSnapshot,
  SESSION_KEY_V1,
  SESSION_KEY_V2,
  SESSION_SCHEMA_VERSION,
  writeSnapshot,
  type SessionSnapshot,
} from './sessionStore'

const sample: SessionSnapshot = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  savedAt: 1_000_000,
  windows: [
    {
      id: 'win-1',
      tabs: [
        { id: 'a', url: 'https://a.example', title: 'A', loading: false, active: false, pinned: false },
        { id: 'b', url: 'https://b.example', title: 'B', loading: false, active: false, pinned: true },
        { id: 'priv', url: 'https://c.example', title: 'C', loading: false, active: false, pinned: false, private: true },
      ],
      activeTabId: 'b',
      scrollPositions: { a: { x: 0, y: 120 } },
      zoomLevels: { a: 1.25 },
    },
  ],
  history: [],
  closedTabs: [],
}

describe('writeSnapshot + readLatestSnapshot', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => localStorage.clear())

  it('writes to v1 on the first call', () => {
    writeSnapshot(sample)
    expect(localStorage.getItem(SESSION_KEY_V1)).not.toBeNull()
    expect(localStorage.getItem(SESSION_KEY_V2)).toBeNull()
    const result = readLatestSnapshot()
    expect(result?.source).toBe('v1')
    expect(result?.snapshot.savedAt).toBe(1_000_000)
  })

  it('rotates after the second write', () => {
    writeSnapshot(sample)
    writeSnapshot({ ...sample, savedAt: 2_000_000 })
    const v2Raw = localStorage.getItem(SESSION_KEY_V2)
    const v1Raw = localStorage.getItem(SESSION_KEY_V1)
    expect(v2Raw).not.toBeNull()
    expect(v1Raw).not.toBeNull()
  })

  it('flags suspect when slots diverge by > 5 s', () => {
    localStorage.setItem(SESSION_KEY_V1, JSON.stringify({ ...sample, savedAt: 1_000_000 }))
    localStorage.setItem(SESSION_KEY_V2, JSON.stringify({ ...sample, savedAt: 1_000_010 }))
    const result = readLatestSnapshot()
    expect(result?.suspect).toBe(false)
    localStorage.setItem(SESSION_KEY_V2, JSON.stringify({ ...sample, savedAt: 1_000_000 }))
    localStorage.setItem(SESSION_KEY_V1, JSON.stringify({ ...sample, savedAt: 900_000 }))
    const drifted = readLatestSnapshot()
    expect(drifted?.source).toBe('v2')
    expect(drifted?.suspect).toBe(true)
  })

  it('ignores corrupt slots', () => {
    localStorage.setItem(SESSION_KEY_V1, 'not-json')
    expect(readLatestSnapshot()).toBeNull()
  })

  it('ignores snapshots with the wrong schema version', () => {
    localStorage.setItem(SESSION_KEY_V1, JSON.stringify({ ...sample, schemaVersion: 1 }))
    expect(readLatestSnapshot()).toBeNull()
  })
})

describe('restoreFromSnapshot', () => {
  it('strips private tabs and falls back to the first tab when active was removed', () => {
    const restored = restoreFromSnapshot(sample)
    expect(restored.tabs.map(tab => tab.id)).toEqual(['a', 'b'])
    expect(restored.activeTabId).toBe('b')
    expect(restored.skipped).toBe(1)
    expect(restored.zoomLevels.a).toBe(1.25)
  })

  it('returns an empty session when no windows are stored', () => {
    const empty = emptySnapshot()
    const restored = restoreFromSnapshot(empty)
    expect(restored.tabs).toEqual([])
    expect(restored.activeTabId).toBe('')
  })

  it('falls back to the first tab when the active id was private', () => {
    const onlyPrivate: SessionSnapshot = {
      ...sample,
      windows: [{ ...sample.windows[0], tabs: sample.windows[0].tabs.filter(tab => tab.private), activeTabId: 'priv' }],
    }
    const restored = restoreFromSnapshot(onlyPrivate)
    expect(restored.tabs).toEqual([])
    expect(restored.skipped).toBe(1)
  })
})