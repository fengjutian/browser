import { useState } from 'react'
import { AppLayout } from '../layouts/AppLayout'
import { BrowserPage } from '../pages/browser/BrowserPage'
import { LibraryPage } from '../pages/library/LibraryPage'
import { SearchPage } from '../pages/search/SearchPage'
import { AssistantPage } from '../pages/assistant/AssistantPage'
import { SettingsPage } from '../pages/settings/SettingsPage'
import type { View } from '../types'

export function AppRouter() {
  const [view, setView] = useState<View>('browser')
  const pages = { browser: <BrowserPage />, library: <LibraryPage />, search: <SearchPage />, ai: <AssistantPage />, settings: <SettingsPage /> }
  return <AppLayout view={view} onViewChange={setView}>{pages[view]}</AppLayout>
}
