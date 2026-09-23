import { describe, expect, it, beforeEach } from 'vitest'
import {
  bindingToDisplay,
  clearShortcutOverride,
  defaultBinding,
  interpretShortcut,
  isOverridden,
  matchBinding,
  readShortcutOverrides,
  resetAllShortcutOverrides,
  SHORTCUT_DEFINITIONS,
  writeShortcutOverrides,
  type ShortcutBinding,
} from './shortcuts'

const evt = (key: string, partial: Partial<{ ctrl: boolean; shift: boolean; alt: boolean }> = {}): { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; key: string } => ({
  ctrlKey: partial.ctrl ?? false,
  metaKey: false,
  shiftKey: partial.shift ?? false,
  altKey: partial.alt ?? false,
  key,
})

describe('interpretShortcut', () => {
  it('matches default Ctrl+L to focusAddress', () => {
    expect(interpretShortcut(evt('l', { ctrl: true }))).toBe('focusAddress')
  })

  it('matches Ctrl+F / Ctrl+P / Ctrl+0 / Ctrl+-', () => {
    expect(interpretShortcut(evt('f', { ctrl: true }))).toBe('find')
    expect(interpretShortcut(evt('p', { ctrl: true }))).toBe('print')
    expect(interpretShortcut(evt('+', { ctrl: true }))).toBe('zoomIn')
    expect(interpretShortcut(evt('-', { ctrl: true }))).toBe('zoomOut')
    expect(interpretShortcut(evt('0', { ctrl: true }))).toBe('zoomReset')
  })

  it('distinguishes Ctrl+T from Ctrl+Shift+T', () => {
    expect(interpretShortcut(evt('t', { ctrl: true }))).toBe('newTab')
    expect(interpretShortcut(evt('T', { ctrl: true, shift: true }))).toBe('reopenClosedTab')
  })

  it('matches the search palette cluster', () => {
    expect(interpretShortcut(evt('k', { ctrl: true }))).toBe('openTabSearch')
    expect(interpretShortcut(evt('A', { ctrl: true, shift: true }))).toBe('openTabSearch')
    expect(interpretShortcut(evt('h', { ctrl: true }))).toBe('openHistorySearch')
    expect(interpretShortcut(evt('O', { ctrl: true, shift: true }))).toBe('openBookmarks')
    expect(interpretShortcut(evt('d', { ctrl: true }))).toBe('addBookmark')
    expect(interpretShortcut(evt('S', { ctrl: true, shift: true }))).toBe('openBulkSummary')
    expect(interpretShortcut(evt('N', { ctrl: true, shift: true }))).toBe('toggleNotesPanel')
  })

  it('matches Alt+Arrow navigation', () => {
    expect(interpretShortcut(evt('ArrowLeft', { alt: true }))).toBe('back')
    expect(interpretShortcut(evt('ArrowRight', { alt: true }))).toBe('forward')
  })

  it('falls through when no pattern matches', () => {
    expect(interpretShortcut(evt('x', { ctrl: true }))).toBeNull()
    expect(interpretShortcut(evt('z'))).toBeNull()
  })

  it('lets overrides win over the default table', () => {
    const overrides = { addBookmark: { key: 'b', ctrl: true, shift: false, alt: false } as ShortcutBinding }
    expect(interpretShortcut(evt('b', { ctrl: true }), overrides)).toBe('addBookmark')
    // Default Ctrl+D no longer matches once addBookmark is overridden
    expect(interpretShortcut(evt('d', { ctrl: true }), overrides)).toBeNull()
  })
})

describe('matchBinding', () => {
  it('treats ctrl and meta as the same primary modifier', () => {
    const event = { ctrlKey: false, metaKey: true, shiftKey: false, altKey: false, key: 'l' }
    expect(matchBinding(event, { key: 'l', ctrl: true, shift: false, alt: false })).toBe(true)
  })

  it('requires exact modifier state', () => {
    const binding: ShortcutBinding = { key: 'k', ctrl: true, shift: false, alt: false }
    expect(matchBinding(evt('k', { ctrl: true }), binding)).toBe(true)
    expect(matchBinding(evt('k', { ctrl: false }), binding)).toBe(false)
    expect(matchBinding(evt('K', { ctrl: true, shift: true }), binding)).toBe(false)
  })
})

describe('bindingToDisplay', () => {
  it('uses friendly glyphs for arrow keys', () => {
    expect(bindingToDisplay({ key: 'ArrowLeft', ctrl: false, shift: false, alt: true })).toBe('Alt + ←')
  })

  it('uppercases single-character keys', () => {
    expect(bindingToDisplay({ key: 'd', ctrl: true, shift: false, alt: false })).toBe('Ctrl + D')
  })

  it('renders Escape as Esc', () => {
    expect(bindingToDisplay({ key: 'Escape', ctrl: false, shift: false, alt: false })).toBe('Esc')
  })
})

describe('overrides persistence', () => {
  beforeEach(() => {
    resetAllShortcutOverrides()
  })

  it('returns an empty map when nothing has been saved', () => {
    expect(readShortcutOverrides()).toEqual({})
  })

  it('round-trips writes through localStorage', () => {
    writeShortcutOverrides({ addBookmark: { key: 'b', ctrl: true, shift: false, alt: false } })
    expect(isOverridden('addBookmark', readShortcutOverrides())).toBe(true)
    expect(readShortcutOverrides().addBookmark?.key).toBe('b')
  })

  it('drops corrupt entries without throwing', () => {
    localStorage.setItem('arcadia-shortcut-overrides', 'not json {')
    expect(readShortcutOverrides()).toEqual({})
  })

  it('clearShortcutOverride removes a single entry', () => {
    writeShortcutOverrides({ addBookmark: { key: 'b', ctrl: true, shift: false, alt: false } })
    clearShortcutOverride('addBookmark')
    expect(isOverridden('addBookmark', readShortcutOverrides())).toBe(false)
  })

  it('resetAllShortcutOverrides wipes everything', () => {
    writeShortcutOverrides({ addBookmark: { key: 'b', ctrl: true, shift: false, alt: false } })
    resetAllShortcutOverrides()
    expect(readShortcutOverrides()).toEqual({})
  })
})

describe('SHORTCUT_DEFINITIONS', () => {
  it('every action has a default and a label', () => {
    for (const def of SHORTCUT_DEFINITIONS) {
      expect(def.label.length).toBeGreaterThan(0)
      expect(def.default.key.length).toBeGreaterThan(0)
    }
  })

  it('defaultBinding returns a clone', () => {
    const a = defaultBinding('focusAddress')
    a.key = 'mutated'
    expect(defaultBinding('focusAddress').key).toBe('l')
  })
})