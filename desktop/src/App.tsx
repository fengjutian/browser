import { ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useEffect, useState } from 'react'
import { AppRouter } from './app/AppRouter'
import { readThemePreference, resolveTheme, THEME_CHANGE_EVENT, type ThemePreference } from './features/settings/theme'

export default function App() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference)
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(preference))

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setResolvedTheme(resolveTheme(readThemePreference()))
    const handlePreference = (event: Event) => {
      const next = (event as CustomEvent<ThemePreference>).detail
      setPreference(next)
      setResolvedTheme(resolveTheme(next))
    }
    media.addEventListener('change', sync)
    window.addEventListener(THEME_CHANGE_EVENT, handlePreference)
    return () => {
      media.removeEventListener('change', sync)
      window.removeEventListener(THEME_CHANGE_EVENT, handlePreference)
    }
  }, [])

  useEffect(() => {
    document.body.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  const dark = resolvedTheme === 'dark'
  return <ConfigProvider locale={zhCN} theme={{ algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, token: { colorPrimary: dark ? '#65a77d' : '#347851', borderRadius: 8, fontSize: 14, controlHeight: 36, fontFamily: '"Source Han Serif SC", "Noto Serif CJK SC", "Noto Serif SC", "Songti SC", SimSun, serif' }, components: { Layout: { siderBg: dark ? '#18211d' : '#edf2ee' }, Menu: { itemBg: dark ? '#18211d' : '#edf2ee', itemColor: dark ? '#a9b7af' : '#68766e', itemHoverBg: dark ? '#24332b' : '#e3ebe5', itemHoverColor: dark ? '#d6e7dc' : '#275f3f', itemSelectedBg: dark ? '#294438' : '#d9e8dd', itemSelectedColor: dark ? '#8fd1a8' : '#275f3f', itemHeight: 42 }, Card: { headerHeight: 44, bodyPadding: 16 }, Form: { itemMarginBottom: 14 }, Tabs: { horizontalItemPadding: '8px 12px', verticalItemPadding: '8px 16px' } } }}><AppRouter /></ConfigProvider>
}
