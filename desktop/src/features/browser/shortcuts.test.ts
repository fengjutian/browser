import { describe, expect, it } from 'vitest'
import { interpretShortcut } from './shortcuts'

describe('interpretShortcut', () => {
  it('focuses the address bar on Ctrl+L', () => {
    expect(interpretShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: 'l' })).toBe('focusAddress')
  })

  it('reopens the last closed tab on Ctrl+Shift+T', () => {
    expect(interpretShortcut({ ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, key: 'T' })).toBe('reopenClosedTab')
  })

  it('opens a new tab on plain Ctrl+T (without shift)', () => {
    expect(interpretShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: 't' })).toBe('newTab')
  })
})
