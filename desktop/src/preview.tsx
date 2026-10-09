// TEMPORARY layout diagnostic harness (not part of the app build).
// Mirrors AppRouter's real DOM shape (.app-content > .route-view[data-view] >
// .page) so scroll containment can be verified in a plain browser.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppLayout } from './layouts/AppLayout'
import { LibraryPage } from './pages/library/LibraryPage'
import { SearchPage } from './pages/search/SearchPage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { AssistantPage } from './pages/assistant/AssistantPage'
import type { View } from './types'
import './styles/main.scss'
import './styles/ui.scss'
import './styles/compact.scss'

const hash = (window.location.hash || '#library').slice(1) as View
const view: View = (['library', 'search', 'ai', 'settings'] as string[]).includes(hash) ? hash : 'library'

function page() {
  if (view === 'library') return <LibraryPage />
  if (view === 'search') return <SearchPage initialQuery="" onOpenUrl={() => {}} />
  if (view === 'ai') return <AssistantPage onNavigate={() => {}} />
  return <SettingsPage />
}

function audit(tag: string) {
  const parts: string[] = [`${tag} view=${view} vh=${window.innerHeight}`]
  for (const sel of ['.app-layout', '.app-sider', '.app-content', '.route-view', '.page']) {
    const el = document.querySelector(sel)
    if (!el) { parts.push(`${sel}=MISSING`); continue }
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const clip = el.scrollHeight - el.clientHeight
    const before = el.scrollTop
    el.scrollTop = 9999
    const after = el.scrollTop
    el.scrollTop = before
    const wheel = /auto|scroll|overlay/.test(cs.overflowY) ? 'WHEEL' : 'block'
    parts.push(`${sel}[top=${Math.round(r.top)},h=${Math.round(r.height)},oy=${cs.overflowY},clip=${clip},wheel=${wheel},prog=${after > 0 ? 'Y' : 'n'}]`)
  }
  return parts.join(' ')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppLayout view={view} onViewChange={() => {}}>
      <div className="route-view" data-view={view}>{page()}</div>
    </AppLayout>
  </StrictMode>,
)

const shoot = (tag: string) => console.error('AUDIT ' + audit(tag))
shoot('sync')
for (const ms of [50, 200, 600, 1200, 2500]) window.setTimeout(() => shoot(`t${ms}`), ms)