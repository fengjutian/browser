import { describe, expect, it } from 'vitest'
import { interpretShortcut } from './shortcuts'

describe('interpretShortcut', () => {
  it('focuses the address bar on Ctrl+L', () => {
    expect(interpretShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: 'l' })).toBe('focusAddress')
  })

  it('supports find, print, and zoom shortcuts', () => {
    const event = { ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }
    expect(interpretShortcut({ ...event, key: 'f' })).toBe('find')
    expect(interpretShortcut({ ...event, key: 'p' })).toBe('print')
    expect(interpretShortcut({ ...event, key: '+' })).toBe('zoomIn')
    expect(interpretShortcut({ ...event, key: '-' })).toBe('zoomOut')
    expect(interpretShortcut({ ...event, key: '0' })).toBe('zoomReset')
  })

  it('reopens the last closed tab on Ctrl+Shift+T', () => {
    expect(interpretShortcut({ ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, key: 'T' })).toBe('reopenClosedTab')
  })

  it('opens a new tab on plain Ctrl+T (without shift)', () => {
    expect(interpretShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: 't' })).toBe('newTab')
  })
})
