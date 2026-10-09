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

function audit() {
  const out: string[] = []
  out.push(`view=${view} vh=${window.innerHeight}`)
  for (const sel of ['.app-layout', '.app-sider', '.app-content', '.route-view', '.page']) {
    const el = document.querySelector(sel)
    if (!el) { out.push(`${sel}=MISSING`); continue }
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const clip = el.scrollHeight - el.clientHeight
    const before = el.scrollTop
    el.scrollTop = 9999
    const after = el.scrollTop
    el.scrollTop = before
    out.push(`${sel} top=${Math.round(r.top)} h=${Math.round(r.height)} oy=${cs.overflowY} clip=${clip} progScroll=${after > 0 ? 'YES' : 'no'}`)
  }
  return out.join(' ;; ')
}

const diag = document.createElement('pre')
diag.id = 'diag'
diag.textContent = 'pending'
diag.style.cssText = 'position:fixed;left:8px;top:44px;z-index:99999;margin:0;padding:8px;background:#000;color:#0f0;font:10px/1.3 monospace;max-width:80vw;white-space:pre-wrap'
document.body.appendChild(diag)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppLayout view={view} onViewChange={() => {}}>
      <div className="route-view" data-view={view}>{page()}</div>
    </AppLayout>
  </StrictMode>,
)

let n = 0
const tick = window.setInterval(() => {
  diag.textContent = audit()
  console.log('AUDIT ' + diag.textContent.replace(/\s+/g, ' '))
  if (++n >= 4) window.clearInterval(tick)
}, 400)