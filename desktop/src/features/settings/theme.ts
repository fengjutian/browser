export type ThemePreference = 'green' | 'beige' | 'light' | 'dark' | 'github'

const THEME_STORAGE_KEY = 'arcadia-theme'
export const THEME_CHANGE_EVENT = 'arcadia-theme-change'

export function readThemePreference(): ThemePreference {
  const saved = localStorage.getItem(THEME_STORAGE_KEY)
  return saved === 'green' || saved === 'beige' || saved === 'light' || saved === 'dark' || saved === 'github' ? saved : 'green'
}

export function writeThemePreference(theme: ThemePreference) {
  localStorage.setItem(THEME_STORAGE_KEY, theme)
  window.dispatchEvent(new CustomEvent<ThemePreference>(THEME_CHANGE_EVENT, { detail: theme }))
}
