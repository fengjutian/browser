import { describe, expect, it } from 'vitest'
import { interpretShortcut, type ShortcutEvent } from './shortcuts'

const press = (key: string, modifiers: Partial<Omit<ShortcutEvent, 'key'>> = {}) => interpretShortcut({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers, key })

describe('interpretShortcut', () => {
  it('Ctrl+L focuses the address bar', () => {
    expect(press('l', { ctrlKey: true })).toBe('focusAddress')
  })

  it('Cmd+L focuses the address bar (macOS)', () => {
    expect(press('l', { metaKey: true })).toBe('focusAddress')
  })

  it('Ctrl+Shift+L still focuses the address bar (shift is a free modifier)', () => {
    expect(press('l', { ctrlKey: true, shiftKey: true })).toBe('focusAddress')
  })

  it('Ctrl+T opens a new tab', () => {
    expect(press('t', { ctrlKey: true })).toBe('newTab')
  })

  it('Ctrl+W closes the current tab', () => {
    expect(press('w', { ctrlKey: true })).toBe('closeTab')
  })

  it('Ctrl+Tab advances to the next tab', () => {
    expect(press('Tab', { ctrlKey: true })).toBe('nextTab')
  })

  it('Ctrl+Shift+Tab moves to the previous tab', () => {
    expect(press('Tab', { ctrlKey: true, shiftKey: true })).toBe('prevTab')
  })

  it('Ctrl+1 through Ctrl+9 jumps to a numbered tab', () => {
    for (const digit of '123456789') {
      expect(press(digit, { ctrlKey: true })).toBe('jumpToTab')
    }
  })

  it('Ctrl+0 is not a jump shortcut', () => {
    expect(press('0', { ctrlKey: true })).toBeNull()
  })

  it('Alt+ArrowLeft navigates back', () => {
    expect(press('ArrowLeft', { altKey: true })).toBe('back')
  })

  it('Alt+ArrowRight navigates forward', () => {
    expect(press('ArrowRight', { altKey: true })).toBe('forward')
  })

  it('F5 reloads the current tab', () => {
    expect(press('F5')).toBe('reload')
  })

  it('Ctrl+R reloads the current tab', () => {
    expect(press('r', { ctrlKey: true })).toBe('reload')
  })

  it('Escape stops loading', () => {
    expect(press('Escape')).toBe('stop')
  })

  it('plain keys produce no action', () => {
    expect(press('a')).toBeNull()
    expect(press('Enter')).toBeNull()
    expect(press('ArrowLeft')).toBeNull()
  })

  it('modifier-only keys do not match without their letter', () => {
    expect(press('l', { shiftKey: true })).toBeNull()
    expect(press('t', { altKey: true })).toBeNull()
  })
})