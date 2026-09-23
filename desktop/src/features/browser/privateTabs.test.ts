import { describe, expect, it } from 'vitest'
import { isPrivateTab, makePrivateTab, stripPrivateTabs } from './privateTabs'
import type { BrowserTab } from '../../types'

const sample: BrowserTab = {
  id: 'normal',
  url: 'https://example.com',
  title: 'Example',
  loading: false,
  active: false,
  pinned: false,
}

describe('privateTabs', () => {
  it('isPrivateTab returns true only when the flag is set', () => {
    expect(isPrivateTab(sample)).toBe(false)
    expect(isPrivateTab({ ...sample, private: true })).toBe(true)
    expect(isPrivateTab(undefined)).toBe(false)
  })

  it('makePrivateTab sets the flag and a sane default title', () => {
    const tab = makePrivateTab('id-1')
    expect(tab.private).toBe(true)
    expect(tab.id).toBe('id-1')
    expect(tab.url).toBe('')
    expect(tab.title).toBe('新私密窗口')
  })

  it('stripPrivateTabs drops every tab with private: true', () => {
    const list: BrowserTab[] = [
      sample,
      { ...sample, id: 'private-1', private: true },
      { ...sample, id: 'pinned' },
      { ...sample, id: 'private-2', private: true },
    ]
    expect(stripPrivateTabs(list).map(tab => tab.id)).toEqual(['normal', 'pinned'])
  })

  it('stripPrivateTabs preserves non-private order', () => {
    const list: BrowserTab[] = [
      { ...sample, id: 'a' },
      { ...sample, id: 'b', private: true },
      { ...sample, id: 'c' },
    ]
    const stripped = stripPrivateTabs(list)
    expect(stripped).toHaveLength(2)
    expect(stripped.map(tab => tab.id)).toEqual(['a', 'c'])
  })
})