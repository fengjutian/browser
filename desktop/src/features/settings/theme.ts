export type ThemePreference = 'light' | 'dark' | 'system'

const THEME_STORAGE_KEY = 'arcadia-theme'
export const THEME_CHANGE_EVENT = 'arcadia-theme-change'

export function readThemePreference(): ThemePreference {
  const saved = localStorage.getItem(THEME_STORAGE_KEY)
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'
}

export function writeThemePreference(theme: ThemePreference) {
  localStorage.setItem(THEME_STORAGE_KEY, theme)
  window.dispatchEvent(new CustomEvent<ThemePreference>(THEME_CHANGE_EVENT, { detail: theme }))
}

export function resolveTheme(theme: ThemePreference): 'light' | 'dark' {
  return theme === 'system'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    : theme
}
