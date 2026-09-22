import { MouseEvent, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Button, Card, Dropdown, Input, Segmented, Space, Tabs, Tag, Tooltip, Typography, message, type InputRef, type MenuProps } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, BookOutlined, CloseOutlined, CopyOutlined, GlobalOutlined, LoadingOutlined, PlusOutlined, ReloadOutlined, RobotOutlined, SafetyCertificateOutlined, SaveOutlined, SearchOutlined, StarOutlined, ThunderboltOutlined, TranslationOutlined } from '@ant-design/icons'
import type { BrowserTab, BrowserTabError } from '../../types'
import { findDocumentByUrl, getDocument, getSession, saveDocument, setSession, toggleStarred } from '../../api'
import { captureNativePage, closeNativeTab, ensureNativeTab, hasNativeTab, hideNativeTab, navigateHistory, onNativeNewTab, openNativeTab, readNativeState, reloadNativeTab, resizeNativeTab, showNativeTab, stopNativeTab } from '../../services/nativeBrowser'
import { extractArticle } from '../../features/reader/extractArticle'
import type { ReaderArticle } from '../../features/reader/types'
import { classifySaveError } from '../../features/documents/saveClassifier'
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue'
import { dedupeHistory, parseHistory, type HistoryEntry } from '../../features/history/dedupeHistory'
import { reorderTabs } from '../../features/browser/reorderTabs'
import { interpretShortcut } from '../../features/browser/shortcuts'
import { popClosedTab, recordClosedTab, type ClosedTab } from '../../features/browser/closedTabs'
import { AssistantPanel } from '../../features/ai/AssistantPanel'
import { resolveNavigationInput } from '../../features/browser/navigation'

const SESSION_KEY = 'browser.tabs'
const SESSION_DEBOUNCE_MS = 500
const HISTORY_KEY = 'browser.history'
const CLOSED_KEY = 'browser.closed'

interface QuickSite {
  name: string
  url: string
  initial: string
  color: string
}

const QUICK_SITES: QuickSite[] = [
  { name: 'GitHub', url: 'https://github.com', initial: 'G', color: '#1f2328' },
  { name: '掘金', url: 'https://juejin.cn', initial: 'J', color: '#1e80ff' },
  { name: 'MDN', url: 'https://developer.mozilla.org', initial: 'M', color: '#1d2421' },
  { name: 'ChatGPT', url: 'https://chat.openai.com', initial: 'C', color: '#10a37f' },
  { name: '知乎', url: 'https://www.zhihu.com', initial: '知', color: '#0084ff' },
  { name: 'Bilibili', url: 'https://www.bilibili.com', initial: 'B', color: '#fb7299' },
  { name: 'arXiv', url: 'https://arxiv.org', initial: 'a', color: '#b31b1b' },
  { name: 'Google Scholar', url: 'https://scholar.google.com', initial: 'S', color: '#4285f4' },
  { name: 'Hacker News', url: 'https://news.ycombinator.com', initial: 'H', color: '#ff6600' },
  { name: 'Wikipedia', url: 'https://www.wikipedia.org', initial: 'W', color: '#1d2421' },
  { name: '百度', url: 'https://www.baidu.com', initial: '百', color: '#2932e1' },
  { name: '微博', url: 'https://weibo.com', initial: '微', color: '#e6162d' },
  { name: '小红书', url: 'https://www.xiaohongshu.com', initial: '红', color: '#ff2442' },
  { name: '淘宝', url: 'https://www.taobao.com', initial: '淘', color: '#ff5000' },
]

const newTab = (id: string = crypto.randomUUID()): BrowserTab => ({ id, url: '', title: '新标签页', loading: false, active: true, pinned: false })

interface PersistedSession {
  tabs: BrowserTab[]
  activeTabId: string
}

function parsePersistedSession(raw: string | null): PersistedSession | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<PersistedSession>
    if (!value || !Array.isArray(value.tabs) || value.tabs.length === 0) return null
    if (typeof value.activeTabId !== 'string') return null
    if (!value.tabs.some(tab => tab.id === value.activeTabId)) return null
    return { tabs: value.tabs as BrowserTab[], activeTabId: value.activeTabId }
  } catch { return null }
}

function parseClosedTabs(raw: string | null): ClosedTab[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    return value.filter((item): item is ClosedTab => (
      !!item && typeof item === 'object'
      && typeof (item as ClosedTab).url === 'string'
      && typeof (item as ClosedTab).id === 'string'
      && typeof (item as ClosedTab).closedAt === 'number'
    ))
  } catch { return [] }
}

function classifyNavigationError(error: unknown): BrowserTabError {
  const message = String(error)
  const protocolMatch = /^(external|blocked|unknown)-protocol:([a-z]+)/i.exec(message)
  if (protocolMatch) {
    const scheme = protocolMatch[2]
    return { kind: 'unsupported-protocol', message: `不支持的协议：${scheme}://（应用仅打开 http/https 链接）` }
  }
  return { kind: 'load-failed', message }
}

export function BrowserPage() {
  const [tabs, setTabs] = useState<BrowserTab[]>([newTab('new')])
  const [activeTabId, setActiveTabId] = useState('new')
  const [address, setAddress] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [readerArticle, setReaderArticle] = useState<ReaderArticle | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [closedTabs, setClosedTabs] = useState<ClosedTab[]>([])
  const [starredDocId, setStarredDocId] = useState<string | null>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [messageApi, contextHolder] = message.useMessage()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<InputRef>(null)
  const previousTab = useRef<string | undefined>(undefined)
  const activeTabIdRef = useRef(activeTabId)
  const tabsRef = useRef(tabs)
  const closedTabsRef = useRef(closedTabs)
  const lastHistoryUrl = useRef<string>('')
  const active = tabs.find(tab => tab.id === activeTabId) ?? tabs[0]
  const nativeMode = hasNativeTab(active.id)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      getSession(SESSION_KEY),
      getSession(HISTORY_KEY),
      getSession(CLOSED_KEY),
    ]).then(([tabsRaw, historyRaw, closedRaw]) => {
      if (cancelled) return
      const parsed = parsePersistedSession(tabsRaw)
      if (parsed) {
        setTabs(parsed.tabs)
        setActiveTabId(parsed.activeTabId)
        const activeTab = parsed.tabs.find(tab => tab.id === parsed.activeTabId)
        setAddress(activeTab?.url ?? '')
        if (activeTab?.url) lastHistoryUrl.current = activeTab.url
      }
      setHistory(parseHistory(historyRaw))
      setClosedTabs(parseClosedTabs(closedRaw))
      setHydrated(true)
      if (parsed) {
        void (async () => {
          await new Promise(resolve => requestAnimationFrame(resolve))
          if (cancelled) return
          const nextBounds = bounds()
          if (!nextBounds) return
          await Promise.all(parsed.tabs.filter(tab => tab.url).map(async tab => {
            try {
              const opened = await ensureNativeTab(tab.id, tab.url, nextBounds)
              if (!opened) {
                setTabs(current => current.map(item => item.id === tab.id ? { ...item, error: { kind: 'web-mode-required', message: '网页浏览仅在 Tauri 桌面应用中可用。' } } : item))
                return
              }
              if (tab.id === parsed.activeTabId) await showNativeTab(tab.id)
              else await hideNativeTab(tab.id)
            } catch (error) {
              setTabs(current => current.map(item => item.id === tab.id ? { ...item, error: { kind: 'load-failed', message: String(error) } } : item))
            }
          }))
        })()
      }
    })
    return () => { cancelled = true }
  }, [])

  const sessionJson = useDebouncedValue(JSON.stringify({ tabs, activeTabId }), SESSION_DEBOUNCE_MS)
  useEffect(() => {
    if (!hydrated) return
    void setSession(SESSION_KEY, sessionJson)
  }, [sessionJson, hydrated])

  const historyJson = useDebouncedValue(JSON.stringify(history), SESSION_DEBOUNCE_MS)
  useEffect(() => {
    if (!hydrated) return
    void setSession(HISTORY_KEY, historyJson)
  }, [historyJson, hydrated])

  const closedJson = useDebouncedValue(JSON.stringify(closedTabs), SESSION_DEBOUNCE_MS)
  useEffect(() => {
    if (!hydrated) return
    void setSession(CLOSED_KEY, closedJson)
  }, [closedJson, hydrated])

  useEffect(() => {
    if (!hydrated || !active.url || active.url === lastHistoryUrl.current) return
    lastHistoryUrl.current = active.url
    setHistory(current => dedupeHistory(current, { url: active.url, title: active.title, visitedAt: Date.now() }))
  }, [active.url, active.title, hydrated])

  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])
  useEffect(() => { tabsRef.current = tabs }, [tabs])
  useEffect(() => { closedTabsRef.current = closedTabs }, [closedTabs])

  useEffect(() => {
    const url = active.url
    if (!url) { setStarredDocId(null); return }
    let cancelled = false
    void findDocumentByUrl(url).then(doc => {
      if (cancelled) return
      setStarredDocId(doc?.starred ? doc.id : null)
    }).catch(() => { if (!cancelled) setStarredDocId(null) })
    return () => { cancelled = true }
  }, [active.url])

  const bounds = () => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    return rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : undefined
  }

  useEffect(() => {
    if (previousTab.current && previousTab.current !== active.id) void hideNativeTab(previousTab.current)
    previousTab.current = active.id
    if (hasNativeTab(active.id)) void showNativeTab(active.id)
  }, [active.id])

  useEffect(() => {
    if (!nativeMode || !hasNativeTab(active.id)) return
    const sync = async () => {
      try {
        const state = await readNativeState(active.id)
        if (!state) return
        const fallbackTitle = (() => { try { return new URL(state.url).hostname } catch { return '新标签页' } })()
        setTabs(current => current.map(tab => tab.id === active.id ? { ...tab, url: state.url, title: state.title || fallbackTitle, favicon: state.favicon, loading: state.loading, canGoBack: state.canGoBack, canGoForward: state.canGoForward } : tab))
        setAddress(state.url)
      } catch { /* the page may be navigating between documents */ }
    }
    void sync()
    const timer = window.setInterval(() => void sync(), 750)
    return () => window.clearInterval(timer)
  }, [active.id, nativeMode])

  useEffect(() => {
    if (!surfaceRef.current) return
    const observer = new ResizeObserver(() => { const next = bounds(); if (next) void resizeNativeTab(active.id, next) })
    observer.observe(surfaceRef.current)
    return () => observer.disconnect()
  }, [active.id, aiOpen])

  useEffect(() => () => { tabsRef.current.forEach(tab => { void closeNativeTab(tab.id) }) }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void onNativeNewTab(url => openNewTab(url)).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => { disposed = true; unlisten?.() }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = interpretShortcut(event)
      if (!action) return
      event.preventDefault()
      switch (action) {
        case 'focusAddress':
          addressRef.current?.focus({ cursor: 'all' })
          return
        case 'newTab':
          openNewTab()
          return
        case 'reopenClosedTab':
          reopenLastClosed()
          return
        case 'closeTab':
          closeTab(activeTabIdRef.current)
          return
        case 'nextTab': {
          const current = tabsRef.current.findIndex(tab => tab.id === activeTabIdRef.current)
          const next = (current + 1 + tabsRef.current.length) % tabsRef.current.length
          activateTab(tabsRef.current[next].id)
          return
        }
        case 'prevTab': {
          const current = tabsRef.current.findIndex(tab => tab.id === activeTabIdRef.current)
          const next = (current - 1 + tabsRef.current.length) % tabsRef.current.length
          activateTab(tabsRef.current[next].id)
          return
        }
        case 'jumpToTab': {
          const requested = event.key === '9' ? tabsRef.current.length - 1 : Number(event.key) - 1
          const selected = tabsRef.current[Math.min(requested, tabsRef.current.length - 1)]
          if (selected) activateTab(selected.id)
          return
        }
        case 'back':
          void navigateHistory(activeTabIdRef.current, -1)
          return
        case 'forward':
          void navigateHistory(activeTabIdRef.current, 1)
          return
        case 'stop':
          if (hasNativeTab(activeTabIdRef.current)) void stopNativeTab(activeTabIdRef.current)
          return
        case 'reload':
          if (hasNativeTab(activeTabIdRef.current)) void reloadNativeTab(activeTabIdRef.current)
          return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function navigate(input: string) {
    const url = resolveNavigationInput(input)
    if (!url) return
    const tabId = active.id
    setReaderArticle(null)
    setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, url, title: input.trim(), loading: true, error: undefined } : tab))
    await new Promise(resolve => requestAnimationFrame(resolve))
    const nextBounds = bounds()
    if (!nextBounds) return
    try {
      const opened = await openNativeTab(tabId, url, nextBounds)
      if (!opened) {
        setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, loading: false, error: { kind: 'web-mode-required', message: '网页浏览仅在 Tauri 桌面应用中可用。' } } : tab))
        return
      }
      setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, loading: false, error: undefined } : tab))
    } catch (error) {
      setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, loading: false, error: classifyNavigationError(error) } : tab))
    }
  }

  async function retryActive() {
    const url = active.url
    if (!url) return
    await navigate(url)
  }

  async function copyUrl() {
    const url = active.url
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      messageApi.success('已复制链接')
    } catch {
      messageApi.error('复制失败，请手动复制')
    }
  }

  function openNewTab(url?: string) {
    const tab = newTab()
    const currentId = activeTabIdRef.current
    if (currentId) void hideNativeTab(currentId)
    if (url) { tab.url = url; tab.title = '正在加载…'; tab.loading = true }
    setTabs(current => [...current.map(item => ({ ...item, active: false })), tab])
    activeTabIdRef.current = tab.id
    setActiveTabId(tab.id)
    setAddress(url ?? '')
    setReaderArticle(null)
    if (url) {
      void new Promise(resolve => requestAnimationFrame(resolve)).then(async () => {
        const nextBounds = bounds()
        if (!nextBounds) return
        try {
          const opened = await openNativeTab(tab.id, url, nextBounds)
          if (!opened) {
            setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: { kind: 'web-mode-required', message: '网页浏览仅在 Tauri 桌面应用中可用。' } } : item))
            return
          }
          setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: undefined } : item))
        } catch (error) {
          setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: { kind: 'load-failed', message: String(error) } } : item))
        }
      })
    }
  }

  function activateTab(id: string) {
    const selected = tabs.find(tab => tab.id === id)
    setTabs(current => current.map(tab => ({ ...tab, active: tab.id === id })))
    setActiveTabId(id)
    activeTabIdRef.current = id
    setAddress(selected?.url ?? '')
    setReaderArticle(null)
  }

  function duplicateTab(tab: BrowserTab) {
    openNewTab(tab.url || undefined)
  }

  function togglePinned(id: string) {
    setTabs(current => {
      const updated = current.map(tab => tab.id === id ? { ...tab, pinned: !tab.pinned } : tab)
      return [...updated.filter(tab => tab.pinned), ...updated.filter(tab => !tab.pinned)]
    })
  }

  function closeTabs(ids: string[]) {
    const targets = new Set(ids)
    ids.forEach(id => { void closeNativeTab(id) })
    setTabs(current => {
      const remaining = current.filter(tab => !targets.has(tab.id))
      if (!remaining.length) {
        const replacement = newTab()
        activeTabIdRef.current = replacement.id
        setActiveTabId(replacement.id)
        setAddress('')
        return [replacement]
      }
      if (targets.has(activeTabIdRef.current)) {
        const next = remaining[0]
        activeTabIdRef.current = next.id
        setActiveTabId(next.id)
        setAddress(next.url)
        return remaining.map(tab => ({ ...tab, active: tab.id === next.id }))
      }
      return remaining
    })
  }

  function tabMenu(tab: BrowserTab, index: number): MenuProps['items'] {
    return [
      { key: 'reload', label: '重新加载', disabled: !hasNativeTab(tab.id), onClick: () => void reloadNativeTab(tab.id) },
      { key: 'duplicate', label: '复制标签页', disabled: !tab.url, onClick: () => duplicateTab(tab) },
      { key: 'pin', label: tab.pinned ? '取消固定' : '固定标签页', onClick: () => togglePinned(tab.id) },
      { type: 'divider' },
      { key: 'close', label: '关闭标签页', onClick: () => closeTab(tab.id) },
      { key: 'close-others', label: '关闭其他标签页', disabled: tabs.length < 2, onClick: () => closeTabs(tabs.filter(item => item.id !== tab.id && !item.pinned).map(item => item.id)) },
      { key: 'close-right', label: '关闭右侧标签页', disabled: index === tabs.length - 1, onClick: () => closeTabs(tabs.slice(index + 1).filter(item => !item.pinned).map(item => item.id)) },
    ]
  }

  function onTabDragStart(index: number) {
    return (event: React.DragEvent) => {
      setDraggingIndex(index)
      event.dataTransfer.effectAllowed = 'move'
    }
  }
  function onTabDragOver(index: number) {
    return (event: React.DragEvent) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (dragOverIndex !== index) setDragOverIndex(index)
    }
  }
  function onTabDrop(toIndex: number) {
    return (event: React.DragEvent) => {
      event.preventDefault()
      const from = draggingIndex
      setDraggingIndex(null)
      setDragOverIndex(null)
      if (from === null || from === toIndex) return
      setTabs(current => reorderTabs(current, from, toIndex))
    }
  }
  function onTabDragEnd() {
    setDraggingIndex(null)
    setDragOverIndex(null)
  }

  function closeTab(id: string) {
    void closeNativeTab(id)
    const closing = tabs.find(tab => tab.id === id)
    if (closing && closing.url) {
      const entry: ClosedTab = { id: closing.id, url: closing.url, title: closing.title, favicon: closing.favicon, closedAt: Date.now() }
      setClosedTabs(current => recordClosedTab(current, entry))
    }
    const closedIndex = tabs.findIndex(tab => tab.id === id)
    const remaining = tabs.filter(tab => tab.id !== id)
    if (!remaining.length) {
      const replacement = newTab()
      setTabs([replacement])
      setActiveTabId(replacement.id)
      activeTabIdRef.current = replacement.id
      setAddress('')
      return
    }
    if (id === activeTabIdRef.current) {
      const next = remaining[Math.min(closedIndex, remaining.length - 1)]
      setTabs(remaining.map(tab => ({ ...tab, active: tab.id === next.id })))
      setActiveTabId(next.id)
      activeTabIdRef.current = next.id
      setAddress(next.url)
      return
    }
    setTabs(remaining)
  }

  function reopenLastClosed() {
    const result = popClosedTab(closedTabsRef.current)
    if (!result) return
    setClosedTabs(result.remaining)
    const restored = result.popped
    const tab: BrowserTab = {
      id: crypto.randomUUID(),
      url: restored.url,
      title: restored.title || '正在加载…',
      favicon: restored.favicon,
      loading: true,
      active: true,
      pinned: false,
    }
    setTabs(current => [...current.map(item => ({ ...item, active: false })), tab])
    activeTabIdRef.current = tab.id
    setActiveTabId(tab.id)
    setAddress(restored.url)
    setReaderArticle(null)
    void new Promise(resolve => requestAnimationFrame(resolve)).then(async () => {
      const nextBounds = bounds()
      if (!nextBounds) return
      try {
        await ensureNativeTab(tab.id, restored.url, nextBounds)
        if (activeTabIdRef.current === tab.id) await showNativeTab(tab.id)
      } catch (error) {
        setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: { kind: 'load-failed', message: String(error) } } : item))
      } finally {
        setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false } : item))
      }
    })
  }

  async function save() {
    const key = 'save-document'
    try {
      messageApi.open({ key, type: 'loading', content: '正在保存并提取…', duration: 0 })
      let article = readerArticle
      if (!article && hasNativeTab(active.id)) article = extractArticle(await captureNativePage(active.id))
      if (!article?.markdown?.trim()) throw new Error('reader_content_not_found')
      const created = await saveDocument({ title: article.title || active.title, url: active.url || 'about:blank', markdown: article.markdown, tags: ['Inbox'] })
      setStarredDocId(created.id)
      for (let attempt = 0; attempt < 30; attempt++) {
        const document = await getDocument(created.id)
        if (document.status === 'READY') { messageApi.open({ key, type: 'success', content: '已收藏并完成索引' }); return }
        if (document.status === 'FAILED') throw new Error('processing failed')
        await new Promise(resolve => window.setTimeout(resolve, 200))
      }
      messageApi.open({ key, type: 'info', content: '已收藏，后台仍在处理中' })
    } catch (error) {
      const kind = classifySaveError(error)
      const contentEmpty = kind === 'reader_content_not_found'
      messageApi.open({ key, type: contentEmpty ? 'error' : 'warning', content: contentEmpty ? '无法识别该页面正文，已取消保存' : '后端离线或处理失败，请稍后重试' })
    }
  }

  async function toggleStarCurrent() {
    const url = active.url
    if (!url) return
    const key = 'star-toggle'
    if (starredDocId) {
      try {
        await toggleStarred(starredDocId, false)
        setStarredDocId(null)
        messageApi.open({ key, type: 'success', content: '已取消收藏', duration: 2 })
      } catch {
        messageApi.open({ key, type: 'error', content: '取消收藏失败', duration: 2 })
      }
      return
    }
    await save()
  }

  async function openReader() {
    if (!hasNativeTab(active.id)) { messageApi.info('请先在桌面应用中打开一个网页'); return }
    const key = 'reader'
    try {
      messageApi.open({ key, type: 'loading', content: '正在提取正文…', duration: 0 })
      const article = extractArticle(await captureNativePage(active.id))
      await hideNativeTab(active.id)
      setReaderArticle(article)
      messageApi.open({ key, type: 'success', content: `已提取 ${article.wordCount} 字` })
    } catch { messageApi.open({ key, type: 'error', content: '无法识别该页面正文' }) }
  }

  return <div className="browser-page">{contextHolder}
    <div className="browser-tabs" style={{ '--tab-count': tabs.length } as CSSProperties}><Tabs type="editable-card" items={tabs.map((tab, index) => {
          const isDragging = draggingIndex === index
          const isDropTarget = dragOverIndex === index && draggingIndex !== null && draggingIndex !== index
          return {
            key: tab.id,
            label: <Dropdown menu={{ items: tabMenu(tab, index) }} trigger={['contextMenu']}>
              <Tooltip title={tab.url || '新标签页'} mouseEnterDelay={0.6}>
              <span
                draggable
                onAuxClick={event => { if (event.button === 1 && !tab.pinned) closeTab(tab.id) }}
                onDragStart={onTabDragStart(index)}
                onDragOver={onTabDragOver(index)}
                onDrop={onTabDrop(index)}
                onDragEnd={onTabDragEnd}
                className={`browser-tab-title${isDragging ? ' is-dragging' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
              >{tab.loading ? <LoadingOutlined spin/> : tab.favicon ? <img src={tab.favicon} alt=""/> : <GlobalOutlined/>}<span>{tab.title}</span></span>
              </Tooltip>
            </Dropdown>,
            className: tab.pinned ? 'browser-tab--pinned' : undefined,
            closable: tabs.length > 1 && !tab.pinned,
          }
        })} activeKey={activeTabId} onChange={activateTab} addIcon={<Tooltip title="新建标签页 (Ctrl+T)"><PlusOutlined aria-label="新建标签页"/></Tooltip>} onEdit={(target, action) => action === 'add' ? openNewTab() : closeTab(String(target))}/></div>
    <div className="browser-toolbar"><Space><Button type="text" aria-label="后退" title="后退 (Alt+←)" icon={<ArrowLeftOutlined/>} disabled={!nativeMode || !active.canGoBack} onClick={() => void navigateHistory(active.id,-1)}/><Button type="text" aria-label="前进" title="前进 (Alt+→)" icon={<ArrowRightOutlined/>} disabled={!nativeMode || !active.canGoForward} onClick={() => void navigateHistory(active.id,1)}/><Button type="text" aria-label={active.loading?'停止加载':'重新加载'} title={active.loading?'停止加载 (Esc)':'重新加载 (F5)'} icon={active.loading?<CloseOutlined/>:<ReloadOutlined/>} disabled={!nativeMode} onClick={() => void (active.loading ? stopNativeTab(active.id) : reloadNativeTab(active.id))}/><Button type="text" icon={<BookOutlined/>} onClick={() => void openReader()}>阅读模式</Button></Space><form onSubmit={event => { event.preventDefault(); void navigate(address) }}><Input ref={addressRef} prefix={<SafetyCertificateOutlined/>} suffix={<button type="button" className={`browser-star${starredDocId ? ' is-active' : ''}`} disabled={!active.url} aria-label={starredDocId ? '取消收藏' : '收藏当前页'} title={starredDocId ? '取消收藏' : '收藏当前页'} onClick={event => { event.preventDefault(); event.stopPropagation(); void toggleStarCurrent() }}><StarOutlined/></button>} value={address} onFocus={event=>event.currentTarget.select()} onChange={event=>setAddress(event.target.value)} placeholder="搜索或输入网址"/></form><Tag icon={<SafetyCertificateOutlined/>} color="green">43</Tag><Button type={aiOpen?'primary':'text'} ghost={aiOpen} icon={<RobotOutlined/>} onClick={()=>setAiOpen(value=>!value)}/></div>
    <div className="browser-content"><div className="web-surface" ref={surfaceRef}>{readerArticle
      ? <ReaderArticleView article={readerArticle}/>
      : active.error
        ? <BrowserErrorView tab={active} onRetry={retryActive} onNewTab={openNewTab} onCopy={copyUrl}/>
        : nativeMode
          ? null
          : active.loading
            ? <div className="web-surface__loading"><LoadingOutlined spin/></div>
            : active.url
              ? <BrowserErrorView tab={{...active, error:{kind:'web-mode-required',message:'当前网页需要在 Tauri 桌面应用中打开。'}}} onRetry={retryActive} onNewTab={openNewTab} onCopy={copyUrl}/>
              : <NewTab address={address} setAddress={setAddress} navigate={navigate}/>}</div>{aiOpen&&<AssistantPanel close={()=>setAiOpen(false)} saveToLibrary={save} currentUrl={active.url} currentTabId={active.id} readerArticle={readerArticle}/>}</div>
  </div>
}

function NewTab({address,setAddress,navigate}:{address:string;setAddress:(value:string)=>void;navigate:(input:string)=>Promise<void>}) { return <div className="new-tab"><span className="new-tab__icon"><ThunderboltOutlined/></span><Typography.Title>今天想探索什么？</Typography.Title><Typography.Paragraph>深入阅读，保存重要内容，随时向你的知识库提问。</Typography.Paragraph><form onSubmit={event=>{event.preventDefault();void navigate(address)}}><Input size="large" prefix={<SearchOutlined/>} value={address} onChange={event=>setAddress(event.target.value)} placeholder="搜索网页或输入 URL"/></form><div className="quick-actions"><Card><BookOutlined/><b>Reader Mode</b><small>更专注地阅读</small></Card><Card><RobotOutlined/><b>AI 摘要</b><small>快速理解页面</small></Card><Card><SaveOutlined/><b>知识库</b><small>沉淀重要内容</small></Card></div><div className="quick-sites"><div className="quick-sites__label">常用网站</div><div className="quick-sites__grid">{QUICK_SITES.map(site => <button key={site.url} type="button" className="quick-site" title={site.name} aria-label={`打开 ${site.name}`} onClick={(event:MouseEvent<HTMLButtonElement>)=>{event.currentTarget.blur();void navigate(site.url)}}><span className="quick-site__mark" style={{background:site.color}}>{site.initial}</span><span className="quick-site__name">{site.name}</span></button>)}</div></div></div> }

function BrowserErrorView({tab, onRetry, onNewTab, onCopy}:{tab:BrowserTab;onRetry:()=>void;onNewTab:()=>void;onCopy:()=>void}) {
  const error = tab.error
  const kind = error?.kind ?? 'load-failed'
  const message = error?.message ?? '未知错误'
  const title = kind === 'web-mode-required'
    ? '请在 Tauri 桌面应用中打开网页'
    : kind === 'unsupported-protocol'
      ? '应用不支持该协议'
      : '无法加载该网页'
  const eyebrow = kind === 'web-mode-required'
    ? '需要桌面应用'
    : kind === 'unsupported-protocol'
      ? '协议被拦截'
      : '加载失败'
  return <div className="browser-error">
    <Typography.Text className="eyebrow">{eyebrow}</Typography.Text>
    <Typography.Title level={3}>{title}</Typography.Title>
    <Typography.Paragraph type="secondary">{message}</Typography.Paragraph>
    {tab.url && <Typography.Text code className="browser-error__url">{tab.url}</Typography.Text>}
    <Space wrap>
      {kind === 'load-failed' && <Button type="primary" icon={<ReloadOutlined/>} onClick={onRetry}>重试</Button>}
      <Button icon={<PlusOutlined/>} onClick={onNewTab}>返回新标签页</Button>
      {tab.url && <Button icon={<CopyOutlined/>} onClick={onCopy}>复制 URL</Button>}
    </Space>
  </div>
}
function ReaderArticleView({article}:{article:ReaderArticle}){return <article className="reader-document"><Typography.Text className="eyebrow">READER MODE · {article.wordCount} WORDS</Typography.Text><Typography.Title>{article.title}</Typography.Title>{article.byline&&<Typography.Text type="secondary">{article.byline}</Typography.Text>}<div className="reader-document__body" dangerouslySetInnerHTML={{__html:article.contentHtml}}/></article>}
