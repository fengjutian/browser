import { lazy, Suspense, useState } from 'react'
import { Spin } from 'antd'
import { AppLayout } from '../layouts/AppLayout'
import type { View } from '../types'

const BrowserPage=lazy(()=>import('../pages/browser/BrowserPage').then(module=>({default:module.BrowserPage})))
const LibraryPage=lazy(()=>import('../pages/library/LibraryPage').then(module=>({default:module.LibraryPage})))
const SearchPage=lazy(()=>import('../pages/search/SearchPage').then(module=>({default:module.SearchPage})))
const AssistantPage=lazy(()=>import('../pages/assistant/AssistantPage').then(module=>({default:module.AssistantPage})))
const SettingsPage=lazy(()=>import('../pages/settings/SettingsPage').then(module=>({default:module.SettingsPage})))

export function AppRouter() {
  const [view, setView] = useState<View>('browser')
  const [knowledgeQuery, setKnowledgeQuery] = useState('')
  const pages = {
    library: <LibraryPage />,
    search: <SearchPage initialQuery={knowledgeQuery} />,
    ai: <AssistantPage onNavigate={setView} />,
    settings: <SettingsPage />,
  }
  return <AppLayout view={view} onViewChange={setView}><Suspense fallback={<div className="route-loading"><Spin size="large"/></div>}>
    <div className={`route-view${view === 'browser' ? '' : ' is-hidden'}`} data-view="browser"><BrowserPage visible={view === 'browser'} onSearchKnowledge={query => { setKnowledgeQuery(query); setView('search') }}/></div>
    {view !== 'browser' && <div key={view} className="route-view" data-view={view}>{pages[view]}</div>}
  </Suspense></AppLayout>
}
