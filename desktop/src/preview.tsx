// TEMPORARY layout diagnostic harness (not part of the app build).
// Renders the real AppLayout shell around real pages and writes a scroll
// audit straight into the DOM, so scroll containment can be verified in a
// plain browser without Tauri. Select a page with #library|#search|#ai|#settings.
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

const box = document.createElement('pre')
box.id = 'diag'
box.style.cssText = 'position:fixed;left:8px;top:44px;z-index:99999;margin:0;padding:10px;background:rgba(0,0,0,.9);color:#b9f6ca;font:11px/1.45 monospace;border-radius:8px;white-space:pre;max-height:88vh;overflow:auto'
document.documentElement.appendChild(box)

function audit() {
  const out: string[] = []
  const scrollable = (el: Element) => {
    const cs = getComputedStyle(el)
    return { oy: cs.overflowY, ox: cs.overflowX, can: /auto|scroll|overlay/.test(cs.overflowY), px: el.scrollHeight - el.clientHeight }
  }

  const docEl = document.documentElement
  out.push(`view=${view} vw=${window.innerWidth} vh=${window.innerHeight}`)
  out.push(`html: oy=${getComputedStyle(docEl).overflowY} maxPx=${docEl.scrollHeight - docEl.clientHeight} h=${docEl.clientHeight}`)
  out.push(`body: oy=${getComputedStyle(document.body).overflowY} maxPx=${document.body.scrollHeight - document.body.clientHeight} rectTop=${document.body.getBoundingClientRect().top}`)

  for (const sel of ['.app-layout', '.app-sider', '.app-content', '.route-view', '.page', '.library-tabs']) {
    const el = document.querySelector(sel)
    if (!el) { out.push(`${sel}: MISSING`); continue }
    const s = scrollable(el)
    const r = el.getBoundingClientRect()
    out.push(`${sel.padEnd(14)} h=${String(Math.round(r.height)).padEnd(6)} top=${String(Math.round(r.top)).padEnd(6)} oy=${s.oy.padEnd(8)} ox=${s.ox.padEnd(8)} maxPx=${s.px}`)
  }

  out.push('--- every element with real vertical overflow ---')
  const all = Array.from(document.querySelectorAll<HTMLElement>('*'))
  for (const el of all) {
    const s = scrollable(el)
    if (s.px > 1 && s.can) {
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
      out.push(`  ${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} maxPx=${s.px} oy=${s.oy}`)
    }
  }

  // Which candidates actually respond to a programmatic scroll?
  out.push('--- scrollTop probe (set 9999, then restore) ---')
  for (const sel of ['html', 'body', '.app-layout', '.app-content', '.route-view', '.page']) {
    const el = sel === 'html' ? docEl : sel === 'body' ? document.body : document.querySelector(sel)
    if (!el) { out.push(`  ${sel.padEnd(14)} MISSING`); continue }
    const before = el.scrollTop
    el.scrollTop = 9999
    const after = el.scrollTop
    el.scrollTop = before
    out.push(`  ${sel.padEnd(14)} ${before} -> ${after} ${after > 0 ? 'SCROLLS' : 'fixed'}`)
  }
  return out.join('\n')
}

function run() { box.textContent = audit() }

createRoot(document.getElementById('root')!).render(<StrictMode><AppLayout view={view} onViewChange={() => {}}>{page()}</AppLayout></StrictMode>)
// Poll until the route subtree has painted, then audit; re-audit once more so
// late async layout (fonts, skeletons) is included.
let tries = 0
const tick = window.setInterval(() => {
  run()
  if (++tries >= 6) window.clearInterval(tick)
}, 400)