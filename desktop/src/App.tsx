import { ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useEffect, useState } from 'react'
import { AppRouter } from './app/AppRouter'
import { readThemePreference, THEME_CHANGE_EVENT, type ThemePreference } from './features/settings/theme'

const PALETTES = {
  green: { primary: '#347851', sider: '#edf2ee', item: '#68766e', hover: '#e3ebe5', hoverText: '#275f3f', selected: '#d9e8dd', selectedText: '#275f3f' },
  beige: { primary: '#8a6846', sider: '#f1eadf', item: '#75695d', hover: '#e9decf', hoverText: '#6f5034', selected: '#e1d2bd', selectedText: '#6f5034' },
  light: { primary: '#3f6f5a', sider: '#f3f4f3', item: '#68706c', hover: '#e8ebe9', hoverText: '#334b40', selected: '#dde5e0', selectedText: '#334b40' },
  dark: { primary: '#65a77d', sider: '#18211d', item: '#a9b7af', hover: '#24332b', hoverText: '#d6e7dc', selected: '#294438', selectedText: '#8fd1a8' },
} as const

export default function App() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference)

  useEffect(() => {
    const handlePreference = (event: Event) => {
      const next = (event as CustomEvent<ThemePreference>).detail
      setPreference(next)
    }
    window.addEventListener(THEME_CHANGE_EVENT, handlePreference)
    return () => window.removeEventListener(THEME_CHANGE_EVENT, handlePreference)
  }, [])

  useEffect(() => {
    document.body.dataset.theme = preference
    document.documentElement.style.colorScheme = preference === 'dark' ? 'dark' : 'light'
  }, [preference])

  const palette = PALETTES[preference]
  const dark = preference === 'dark'
  return <ConfigProvider locale={zhCN} theme={{ algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, token: { colorPrimary: palette.primary, borderRadius: 8, fontSize: 14, controlHeight: 36, fontFamily: '"Source Han Serif SC", "Noto Serif CJK SC", "Noto Serif SC", "Songti SC", SimSun, serif' }, components: { Layout: { siderBg: palette.sider }, Menu: { itemBg: palette.sider, itemColor: palette.item, itemHoverBg: palette.hover, itemHoverColor: palette.hoverText, itemSelectedBg: palette.selected, itemSelectedColor: palette.selectedText, itemHeight: 42 }, Card: { headerHeight: 44, bodyPadding: 16 }, Form: { itemMarginBottom: 14 }, Tabs: { horizontalItemPadding: '8px 12px', verticalItemPadding: '8px 16px' } } }}><AppRouter /></ConfigProvider>
}
