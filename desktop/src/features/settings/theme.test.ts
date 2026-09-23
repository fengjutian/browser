import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readThemePreference, THEME_CHANGE_EVENT, writeThemePreference } from './theme'

describe('theme preference', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('uses green when no valid preference is stored', () => {
    expect(readThemePreference()).toBe('green')
    localStorage.setItem('arcadia-theme', 'unknown')
    expect(readThemePreference()).toBe('green')
  })

  it('persists and restores the GitHub theme', () => {
    writeThemePreference('github')
    expect(readThemePreference()).toBe('github')
  })

  it('notifies the app when the theme changes', () => {
    const listener = vi.fn()
    window.addEventListener(THEME_CHANGE_EVENT, listener)
    writeThemePreference('github')
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(THEME_CHANGE_EVENT, listener)
  })
})
