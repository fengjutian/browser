// TEMPORARY layout diagnostic harness (not part of the app build).
// Renders the real AppLayout shell around a real page and reports, on screen,
// every element that is actually scrollable so scroll containment can be
// verified in a plain browser without Tauri or webviews.
import { StrictMode, useState, useEffect } from 'react'
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

const VIEWS: View[] = ['library', 'search', 'ai', 'settings']

function renderPage(view: View) {
  if (view === 'library') return <LibraryPage />
  if (view === 'search') return <SearchPage initialQuery="" onOpenUrl={() => {}} />
  if (view === 'ai') return <AssistantPage onNavigate={() => {}} />
  return <SettingsPage />
}

function useScrollDiagnostics(active: View) {
  const [report, setReport] = useState<string[]>([])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const lines: string[] = []
      const describe = (el: Element) => {
        const cs = getComputedStyle(el)
        const overflowY = cs.overflowY
        const scrollable = el.scrollHeight - el.clientHeight
        const canScroll = /auto|scroll|overlay/.test(overflowY) && scrollable > 1
        return {
          sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''),
          canScroll,
          scrollable,
          overflowY,
          overflowX: cs.overflowX,
          scrollTop: el.scrollTop,
          docScrollable: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        }
      }
      for (const el of [document.documentElement, document.body, ...Array.from(document.querySelectorAll('.app-layout, .app-content, .route-view, .page, .app-sider'))]) {
        const d = describe(el)
        lines.push(`${d.canScroll ? 'SCROLLS ' : '       '} ${d.sel} | overflowY=${d.overflowY} overflowX=${d.overflowX} | overflowPx=${d.scrollable} scrollTop=${d.scrollTop}`)
      }
      lines.push(`DOC scrollable px = ${document.documentElement.scrollHeight - document.documentElement.clientHeight}`)
      lines.push(`VIEW = ${active} | vw=${window.innerWidth} vh=${window.innerHeight}`)
      setReport(lines)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [active])
  return report
}

function Preview() {
  const [view, setView] = useState<View>('library')
  const report = useScrollDiagnostics(view)
  return <AppLayout view={view} onViewChange={setView}>
    {renderPage(view)}
    <pre id="diag" style={{ position: 'fixed', left: 8, bottom: 8, zIndex: 9999, margin: 0, padding: 10, background: 'rgba(0,0,0,.82)', color: '#b9f6ca', font: '11px/1.5 monospace', borderRadius: 8, maxWidth: '70vw', whiteSpace: 'pre-wrap' }}>{report.join('\n')}</pre>
  </AppLayout>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>)