import { ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useEffect, useState } from 'react'
import { AppRouter } from './app/AppRouter'
import { readThemePreference, THEME_CHANGE_EVENT, type ThemePreference } from './features/settings/theme'
import { readAdvancedSettings } from './features/settings/advanced'

const PALETTES = {
  green: { primary: '#347851', sider: '#edf2ee', item: '#68766e', hover: '#e3ebe5', hoverText: '#275f3f', selected: '#d9e8dd', selectedText: '#275f3f' },
  beige: { primary: '#8a6846', sider: '#f1eadf', item: '#75695d', hover: '#e9decf', hoverText: '#6f5034', selected: '#e1d2bd', selectedText: '#6f5034' },
  light: { primary: '#3f6f5a', sider: '#f3f4f3', item: '#68706c', hover: '#e8ebe9', hoverText: '#334b40', selected: '#dde5e0', selectedText: '#334b40' },
  dark: { primary: '#65a77d', sider: '#18211d', item: '#a9b7af', hover: '#24332b', hoverText: '#d6e7dc', selected: '#294438', selectedText: '#8fd1a8' },
  github: { primary: '#0969da', sider: '#f6f8fa', item: '#57606a', hover: '#eaeef2', hoverText: '#1f2328', selected: '#ddf4ff', selectedText: '#0969da' },
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

  useEffect(() => {
    document.body.dataset.reduceMotion = readAdvancedSettings().reduceMotion ? 'true' : 'false'
  }, [])

  const palette = PALETTES[preference]
  const dark = preference === 'dark'
  const github = preference === 'github'
  return <ConfigProvider locale={zhCN} theme={{ algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, token: { colorPrimary: palette.primary, borderRadius: github ? 6 : 10, fontSize: 14, controlHeight: 36, colorBorder: github ? '#d0d7de' : undefined, colorText: github ? '#1f2328' : undefined, colorBgContainer: github ? '#ffffff' : undefined, fontFamily: github ? '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' : 'Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif' }, components: { Layout: { siderBg: palette.sider }, Menu: { itemBg: palette.sider, itemColor: palette.item, itemHoverBg: palette.hover, itemHoverColor: palette.hoverText, itemSelectedBg: palette.selected, itemSelectedColor: palette.selectedText, itemHeight: 44 }, Card: { headerHeight: 44, bodyPadding: 16 }, Form: { itemMarginBottom: 14 }, Tabs: { horizontalItemPadding: '8px 12px', verticalItemPadding: '8px 16px' } } }}><AppRouter /></ConfigProvider>
}
