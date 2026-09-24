import { describe, expect, it } from 'vitest'
import { snapshotTabsToPayload } from './workspaces'

describe('snapshotTabsToPayload privacy', () => {
  it('never persists private tabs in a named workspace', () => {
    const payload = snapshotTabsToPayload([
      { id: 'private', url: 'https://secret.example', title: 'Secret', private: true },
      { id: 'normal', url: 'https://example.com', title: 'Normal' },
    ])

    expect(payload.tabs).toEqual([expect.objectContaining({ id: 'normal', private: false })])
    expect(payload.activeTabId).toBe('normal')
  })
})
