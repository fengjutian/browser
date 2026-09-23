import { describe, expect, it } from 'vitest'
import type { BrowserTab } from '../../types'
import type { WorkspaceRecord } from '../../services/workspaces'
import { restoreTabsFromWorkspace, snapshotsFromWorkspace } from './restoreWorkspace'

function tab(overrides: Partial<BrowserTab>): BrowserTab {
  return {
    id: overrides.id ?? 't',
    url: overrides.url ?? 'about:blank',
    title: overrides.title ?? '',
    favicon: overrides.favicon,
    loading: overrides.loading ?? false,
    active: overrides.active ?? false,
    pinned: overrides.pinned ?? false,
    private: overrides.private ?? false,
    muted: overrides.muted ?? false,
    audible: overrides.audible ?? false,
    crashed: overrides.crashed ?? false,
    groupId: overrides.groupId,
  }
}

function ws(snapshots: Record<string, unknown>[], activeTabId?: string): WorkspaceRecord {
  return {
    id: 'ws-1',
    name: 'test',
    description: '',
    tabCount: snapshots.length,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    payload: { tabs: snapshots, activeTabId },
  }
}

describe('snapshotsFromWorkspace', () => {
  it('returns empty list when payload has no tabs', () => {
    const { snapshots, activeTabId } = snapshotsFromWorkspace(ws([]))
    expect(snapshots).toEqual([])
    expect(activeTabId).toBe('')
  })

  it('drops snapshots without a url', () => {
    const { snapshots } = snapshotsFromWorkspace(ws([
      { id: 'a', url: 'https://a' },
      { id: 'b' },
      { id: 'c', url: 'https://c' },
    ]))
    expect(snapshots.map(s => s.id)).toEqual(['a', 'c'])
  })

  it('falls back to first snapshot id when activeTabId is missing', () => {
    const { activeTabId } = snapshotsFromWorkspace(ws([
      { id: 'a', url: 'https://a' },
      { id: 'b', url: 'https://b' },
    ]))
    expect(activeTabId).toBe('a')
  })

  it('returns null when workspace is null', () => {
    const { snapshots } = snapshotsFromWorkspace(null)
    expect(snapshots).toEqual([])
  })
})

describe('restoreTabsFromWorkspace', () => {
  it('returns current tabs when snapshot is empty', () => {
    const current = [tab({ id: 'a', url: 'https://a' })]
    const result = restoreTabsFromWorkspace(current, ws([]))
    expect(result.tabs).toEqual(current)
    expect(result.addedCount).toBe(0)
    expect(result.removedCount).toBe(0)
  })

  it('keeps matching tabs in place and updates their metadata', () => {
    const result = restoreTabsFromWorkspace([
      tab({ id: 'a', url: 'about:blank', loading: true }),
    ], ws([
      { id: 'a', url: 'https://a', title: 'A', pinned: true },
    ], 'a'))
    expect(result.tabs).toHaveLength(1)
    expect(result.tabs[0]).toMatchObject({ id: 'a', url: 'https://a', title: 'A', pinned: true, loading: true })
    expect(result.activeTabId).toBe('a')
    expect(result.addedCount).toBe(0)
    expect(result.removedCount).toBe(0)
  })

  it('adds new snapshots and drops tabs not in the snapshot', () => {
    const result = restoreTabsFromWorkspace([
      tab({ id: 'a', url: 'https://a' }),
      tab({ id: 'b', url: 'https://b' }),
      tab({ id: 'extra', url: 'https://extra' }),
    ], ws([
      { id: 'a', url: 'https://a' },
      { id: 'new', url: 'https://new', title: 'New' },
    ], 'a'))
    expect(result.tabs.map(t => t.id)).toEqual(['a', 'new'])
    expect(result.addedCount).toBe(1)
    expect(result.removedCount).toBe(2)
    expect(result.activeTabId).toBe('a')
  })

  it('falls back to first tab when activeTabId is not in the result', () => {
    const result = restoreTabsFromWorkspace([], ws([
      { id: 'a', url: 'https://a' },
      { id: 'b', url: 'https://b' },
    ], 'missing'))
    expect(result.activeTabId).toBe('a')
  })
})