import { describe, expect, it } from 'vitest'
import {
  decorateSummaries,
  relativeUpdatedAt,
  validateWorkspaceDescription,
  validateWorkspaceName,
  type WorkspaceSummary,
} from './workspaces'

const base = (overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  id: overrides.id ?? 'ws-1',
  name: overrides.name ?? '工作日标签',
  description: overrides.description ?? '',
  tabCount: overrides.tabCount ?? 3,
  createdAt: overrides.createdAt ?? '2026-01-01T00:00:00Z',
  updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00Z',
})

describe('workspaces.relativeUpdatedAt', () => {
  it('formats sub-minute diffs as 刚刚', () => {
    const now = 1_700_000_000_000
    expect(relativeUpdatedAt(new Date(now).toISOString(), now)).toBe('刚刚')
  })

  it('formats minutes / hours / days', () => {
    const now = 1_700_000_000_000
    const ago = (ms: number) => new Date(now - ms).toISOString()
    expect(relativeUpdatedAt(ago(3 * 60_000), now)).toBe('3 分钟前')
    expect(relativeUpdatedAt(ago(2 * 60 * 60_000), now)).toBe('2 小时前')
    expect(relativeUpdatedAt(ago(3 * 24 * 60 * 60_000), now)).toBe('3 天前')
  })

  it('falls back to ISO date when diff exceeds a month', () => {
    const now = 1_700_000_000_000
    const ago = new Date(now - 90 * 24 * 60 * 60_000).toISOString()
    expect(relativeUpdatedAt(ago, now)).toBe(ago.slice(0, 10))
  })

  it('returns the original string when not parseable', () => {
    expect(relativeUpdatedAt('not a date', Date.now())).toBe('not a date')
  })
})

describe('workspaces.decorateSummaries', () => {
  it('tags empty workspaces and renders friendly relative time', () => {
    const now = 1_700_000_000_000
    const rows = decorateSummaries([
      base({ tabCount: 0, updatedAt: new Date(now).toISOString() }),
      base({ id: 'ws-2', tabCount: 5, updatedAt: new Date(now - 3 * 60_000).toISOString() }),
    ], now)
    expect(rows[0]).toMatchObject({ isEmpty: true, relativeUpdated: '刚刚' })
    expect(rows[1]).toMatchObject({ isEmpty: false, relativeUpdated: '3 分钟前' })
  })
})

describe('workspaces validators', () => {
  it('rejects empty names and names over 80 chars', () => {
    expect(validateWorkspaceName('').ok).toBe(false)
    expect(validateWorkspaceName('   ').ok).toBe(false)
    expect(validateWorkspaceName('a'.repeat(81)).ok).toBe(false)
    expect(validateWorkspaceName('工作日').ok).toBe(true)
    expect(validateWorkspaceName('  工作日  ').ok).toBe(true)
  })

  it('rejects descriptions over 240 chars', () => {
    expect(validateWorkspaceDescription('a'.repeat(241)).ok).toBe(false)
    expect(validateWorkspaceDescription('a'.repeat(240)).ok).toBe(true)
    expect(validateWorkspaceDescription('').ok).toBe(true)
  })
})
