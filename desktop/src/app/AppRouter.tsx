import { lazy, Suspense, useState } from 'react'
import { Spin } from '../components/ui'
import { AppLayout } from '../layouts/AppLayout'
import type { View } from '../types'

const BrowserPage=lazy(()=>import('../pages/browser/BrowserPage').then(module=>({default:module.BrowserPage})))
const LibraryPage=lazy(()=>import('../pages/library/LibraryPage').then(module=>({default:module.LibraryPage})))
const SearchPage=lazy(()=>import('../pages/search/SearchPage').then(module=>({default:module.SearchPage})))
const AssistantPage=lazy(()=>import('../pages/assistant/AssistantPage').then(module=>({default:module.AssistantPage})))
const SettingsPage=lazy(()=>import('../pages/settings/SettingsPage').then(module=>({default:module.SettingsPage})))

export function AppRouter() {
  const [view, setView] = useState<View>('browser')
  const [mountedViews, setMountedViews] = useState<Set<View>>(() => new Set(['browser']))
  const [knowledgeQuery, setKnowledgeQuery] = useState('')
  const changeView = (next: View) => {
    setMountedViews(current => {
      if (current.has(next)) return current
      const updated = new Set(current)
      updated.add(next)
      return updated
    })
    setView(next)
  }
  const pages = {
    library: <LibraryPage />,
    search: <SearchPage initialQuery={knowledgeQuery} onOpenUrl={url => {
      window.dispatchEvent(new CustomEvent('arcadia-browser-open-url', { detail: { url } }))
      changeView('browser')
    }} />,
    ai: <AssistantPage onNavigate={changeView} />,
    settings: <SettingsPage />,
  }
  const secondaryViews: Exclude<View, 'browser'>[] = ['library', 'search', 'ai', 'settings']
  return <AppLayout view={view} onViewChange={changeView}><Suspense fallback={<div className="route-loading"><Spin size="large"/></div>}>
    <div className={`route-view${view === 'browser' ? '' : ' is-hidden'}`} data-view="browser"><BrowserPage visible={view === 'browser'} onSearchKnowledge={query => { setKnowledgeQuery(query); changeView('search') }}/></div>
    {secondaryViews.map(pageView => mountedViews.has(pageView) && (
      <div key={pageView} className={`route-view${view === pageView ? '' : ' is-hidden'}`} data-view={pageView}>{pages[pageView]}</div>
    ))}
  </Suspense></AppLayout>
}
