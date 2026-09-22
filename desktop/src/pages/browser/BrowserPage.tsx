import { MouseEvent, useEffect, useRef, useState } from 'react'
import { Button, Card, Input, Segmented, Space, Tabs, Tag, Tooltip, Typography, message, type InputRef } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, BookOutlined, CloseOutlined, GlobalOutlined, LoadingOutlined, PlusOutlined, ReloadOutlined, RobotOutlined, SafetyCertificateOutlined, SaveOutlined, SearchOutlined, StarOutlined, ThunderboltOutlined, TranslationOutlined } from '@ant-design/icons'
import type { BrowserTab } from '../../types'
import { getDocument, getSession, saveDocument, setSession } from '../../api'
import { captureNativePage, closeNativeTab, hasNativeTab, hideNativeTab, navigateHistory, onNativeNewTab, openNativeTab, readNativeState, reloadNativeTab, resizeNativeTab, showNativeTab, stopNativeTab } from '../../services/nativeBrowser'
import { extractArticle } from '../../features/reader/extractArticle'
import type { ReaderArticle } from '../../features/reader/types'
import { classifySaveError } from '../../features/documents/saveClassifier'
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue'
import { dedupeHistory, parseHistory, type HistoryEntry } from '../../features/history/dedupeHistory'
import { reorderTabs } from '../../features/browser/reorderTabs'
import { interpretShortcut } from '../../features/browser/shortcuts'

const SESSION_KEY = 'browser.tabs'
const SESSION_DEBOUNCE_MS = 500
const HISTORY_KEY = 'browser.history'

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

export function BrowserPage() {
  const [tabs, setTabs] = useState<BrowserTab[]>([newTab('new')])
  const [activeTabId, setActiveTabId] = useState('new')
  const [address, setAddress] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [nativeMode, setNativeMode] = useState(false)
  const [readerArticle, setReaderArticle] = useState<ReaderArticle | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [messageApi, contextHolder] = message.useMessage()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<InputRef>(null)
  const previousTab = useRef<string | undefined>(undefined)
  const activeTabIdRef = useRef(activeTabId)
  const tabsRef = useRef(tabs)
  const lastHistoryUrl = useRef<string>('')
  const active = tabs.find(tab => tab.id === activeTabId) ?? tabs[0]

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      getSession(SESSION_KEY),
      getSession(HISTORY_KEY),
    ]).then(([tabsRaw, historyRaw]) => {
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
      setHydrated(true)
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

  useEffect(() => {
    if (!hydrated || !active.url || active.url === lastHistoryUrl.current) return
    lastHistoryUrl.current = active.url
    setHistory(current => dedupeHistory(current, { url: active.url, title: active.title, visitedAt: Date.now() }))
  }, [active.url, active.title, hydrated])

  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])
  useEffect(() => { tabsRef.current = tabs }, [tabs])

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
        setTabs(current => current.map(tab => tab.id === active.id ? { ...tab, url: state.url, title: state.title || fallbackTitle, favicon: state.favicon, loading: state.loading } : tab))
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
    const trimmed = input.trim()
    if (!trimmed) return
    const url = /^https?:\/\//.test(trimmed) ? trimmed : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
    const tabId = active.id
    setReaderArticle(null)
    setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, url, title: trimmed, loading: true } : tab))
    await new Promise(resolve => requestAnimationFrame(resolve))
    const nextBounds = bounds()
    if (!nextBounds) return
    try {
      const opened = await openNativeTab(tabId, url, nextBounds)
      if (activeTabIdRef.current === tabId) setNativeMode(opened)
      setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, loading: false } : tab))
    } catch (error) {
      if (activeTabIdRef.current === tabId) setNativeMode(false)
      setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, loading: false } : tab))
      messageApi.error(`网页打开失败：${String(error)}`)
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
    setNativeMode(false)
    setReaderArticle(null)
    if (url) {
      void new Promise(resolve => requestAnimationFrame(resolve)).then(async () => {
        const nextBounds = bounds()
        if (!nextBounds) return
        try {
          const opened = await openNativeTab(tab.id, url, nextBounds)
          if (activeTabIdRef.current === tab.id) setNativeMode(opened)
        } catch (error) {
          messageApi.error(`网页打开失败：${String(error)}`)
        } finally {
          setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false } : item))
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
    setNativeMode(hasNativeTab(id))
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
    const closedIndex = tabs.findIndex(tab => tab.id === id)
    const remaining = tabs.filter(tab => tab.id !== id)
    if (!remaining.length) {
      const replacement = newTab()
      setTabs([replacement])
      setActiveTabId(replacement.id)
      activeTabIdRef.current = replacement.id
      setAddress('')
      setNativeMode(false)
      return
    }
    if (id === activeTabIdRef.current) {
      const next = remaining[Math.min(closedIndex, remaining.length - 1)]
      setTabs(remaining.map(tab => ({ ...tab, active: tab.id === next.id })))
      setActiveTabId(next.id)
      activeTabIdRef.current = next.id
      setAddress(next.url)
      setNativeMode(hasNativeTab(next.id))
      return
    }
    setTabs(remaining)
  }

  async function save() {
    const key = 'save-document'
    try {
      messageApi.open({ key, type: 'loading', content: '正在保存并提取…', duration: 0 })
      let article = readerArticle
      if (!article && hasNativeTab(active.id)) article = extractArticle(await captureNativePage(active.id))
      if (!article?.markdown?.trim()) throw new Error('reader_content_not_found')
      const created = await saveDocument({ title: article.title || active.title, url: active.url || 'about:blank', markdown: article.markdown, tags: ['Inbox'] })
      for (let attempt = 0; attempt < 30; attempt++) {
        const document = await getDocument(created.id)
        if (document.status === 'READY') { messageApi.open({ key, type: 'success', content: '已保存并完成索引' }); return }
        if (document.status === 'FAILED') throw new Error('processing failed')
        await new Promise(resolve => window.setTimeout(resolve, 200))
      }
      messageApi.open({ key, type: 'info', content: '已保存，后台仍在处理中' })
    } catch (error) {
      const kind = classifySaveError(error)
      const contentEmpty = kind === 'reader_content_not_found'
      messageApi.open({ key, type: contentEmpty ? 'error' : 'warning', content: contentEmpty ? '无法识别该页面正文，已取消保存' : '后端离线或处理失败，请稍后重试' })
    }
  }

  async function openReader() {
    if (!hasNativeTab(active.id)) { messageApi.info('请先在桌面应用中打开一个网页'); return }
    const key = 'reader'
    try {
      messageApi.open({ key, type: 'loading', content: '正在提取正文…', duration: 0 })
      const article = extractArticle(await captureNativePage(active.id))
      await hideNativeTab(active.id)
      setReaderArticle(article)
      setNativeMode(false)
      messageApi.open({ key, type: 'success', content: `已提取 ${article.wordCount} 字` })
    } catch { messageApi.open({ key, type: 'error', content: '无法识别该页面正文' }) }
  }

  return <div className="browser-page">{contextHolder}
    <div className="browser-tabs"><Tabs type="editable-card" hideAdd items={tabs.map((tab, index) => {
          const isDragging = draggingIndex === index
          const isDropTarget = dragOverIndex === index && draggingIndex !== null && draggingIndex !== index
          return {
            key: tab.id,
            label: <Tooltip title={tab.url || '新标签页'} mouseEnterDelay={0.6}>
              <span
                draggable
                onDragStart={onTabDragStart(index)}
                onDragOver={onTabDragOver(index)}
                onDrop={onTabDrop(index)}
                onDragEnd={onTabDragEnd}
                className={`browser-tab-title${isDragging ? ' is-dragging' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
              >{tab.loading ? <LoadingOutlined spin/> : tab.favicon ? <img src={tab.favicon} alt=""/> : <GlobalOutlined/>}<span>{tab.title}</span></span>
            </Tooltip>,
            closable: tabs.length > 1,
          }
        })} activeKey={activeTabId} onChange={activateTab} onEdit={(target, action) => action === 'remove' && closeTab(String(target))}/><Tooltip title="新建标签页 (Ctrl+T)"><button type="button" aria-label="新建标签页" className="browser-tabs__new-tab" onClick={() => openNewTab()}><PlusOutlined/></button></Tooltip></div>
    <div className="browser-toolbar"><Space><Button type="text" aria-label="后退" title="后退 (Alt+←)" icon={<ArrowLeftOutlined/>} onClick={() => void navigateHistory(active.id,-1)}/><Button type="text" aria-label="前进" title="前进 (Alt+→)" icon={<ArrowRightOutlined/>} onClick={() => void navigateHistory(active.id,1)}/><Button type="text" aria-label={active.loading?'停止加载':'重新加载'} title={active.loading?'停止加载 (Esc)':'重新加载 (F5)'} icon={active.loading?<CloseOutlined/>:<ReloadOutlined/>} onClick={() => void (active.loading ? stopNativeTab(active.id) : reloadNativeTab(active.id))}/><Button type="text" icon={<BookOutlined/>} onClick={() => void openReader()}>阅读模式</Button></Space><form onSubmit={event => { event.preventDefault(); void navigate(address) }}><Input ref={addressRef} prefix={<SafetyCertificateOutlined/>} suffix={<StarOutlined/>} value={address} onFocus={event=>event.currentTarget.select()} onChange={event=>setAddress(event.target.value)} placeholder="搜索或输入网址"/></form><Tag icon={<SafetyCertificateOutlined/>} color="green">43</Tag><Button type={aiOpen?'primary':'text'} ghost={aiOpen} icon={<RobotOutlined/>} onClick={()=>setAiOpen(value=>!value)}/></div>
    <div className="browser-content"><div className="web-surface" ref={surfaceRef}>{readerArticle ? <ReaderArticleView article={readerArticle}/> : !nativeMode && (active.url ? <ReaderPreview/> : <NewTab address={address} setAddress={setAddress} navigate={navigate}/>)}</div>{aiOpen&&<AssistantPanel close={()=>setAiOpen(false)} save={save}/>}</div>
  </div>
}

function NewTab({address,setAddress,navigate}:{address:string;setAddress:(value:string)=>void;navigate:(input:string)=>Promise<void>}) { return <div className="new-tab"><span className="new-tab__icon"><ThunderboltOutlined/></span><Typography.Title>今天想探索什么？</Typography.Title><Typography.Paragraph>深入阅读，保存重要内容，随时向你的知识库提问。</Typography.Paragraph><form onSubmit={event=>{event.preventDefault();void navigate(address)}}><Input size="large" prefix={<SearchOutlined/>} value={address} onChange={event=>setAddress(event.target.value)} placeholder="搜索网页或输入 URL"/></form><div className="quick-actions"><Card><BookOutlined/><b>Reader Mode</b><small>更专注地阅读</small></Card><Card><RobotOutlined/><b>AI 摘要</b><small>快速理解页面</small></Card><Card><SaveOutlined/><b>知识库</b><small>沉淀重要内容</small></Card></div><div className="quick-sites"><div className="quick-sites__label">常用网站</div><div className="quick-sites__grid">{QUICK_SITES.map(site => <button key={site.url} type="button" className="quick-site" title={site.name} aria-label={`打开 ${site.name}`} onClick={(event:MouseEvent<HTMLButtonElement>)=>{event.currentTarget.blur();void navigate(site.url)}}><span className="quick-site__mark" style={{background:site.color}}>{site.initial}</span><span className="quick-site__name">{site.name}</span></button>)}</div></div></div> }
function ReaderPreview(){return <article className="reader-preview"><Typography.Text className="eyebrow">WEBVIEW PREVIEW</Typography.Text><Typography.Title>构建会记忆的系统</Typography.Title><Typography.Paragraph className="lead">浏览器环境预览模式；在 Tauri 桌面应用中这里会替换为真实原生 WebView。</Typography.Paragraph><div className="reader-hero"><ThunderboltOutlined/></div></article>}
function ReaderArticleView({article}:{article:ReaderArticle}){return <article className="reader-document"><Typography.Text className="eyebrow">READER MODE · {article.wordCount} WORDS</Typography.Text><Typography.Title>{article.title}</Typography.Title>{article.byline&&<Typography.Text type="secondary">{article.byline}</Typography.Text>}<div className="reader-document__body" dangerouslySetInnerHTML={{__html:article.contentHtml}}/></article>}
function AssistantPanel({close,save}:{close:()=>void;save:()=>Promise<void>}){return <aside className="ai-panel"><div className="panel-title"><Space><span className="ai-mark"><RobotOutlined/></span><b>AI Assistant</b></Space><Button type="text" icon={<CloseOutlined/>} onClick={close}/></div><Segmented block options={['摘要','提问','翻译']}/><Card size="small" className="context-card"><GlobalOutlined/> 当前页面<Tag color="success">Ready</Tag></Card><Typography.Title level={4}>理解这个页面</Typography.Title><Typography.Paragraph type="secondary">打开文章后可生成有依据的摘要、问答或翻译。</Typography.Paragraph><Space direction="vertical" className="panel-actions"><Button icon={<ThunderboltOutlined/>}>生成 100 字摘要</Button><Button icon={<BookOutlined/>}>提取核心观点</Button><Button icon={<TranslationOutlined/>}>翻译为中文</Button></Space><Card className="ai-preview" size="small"><b><RobotOutlined/> AI 预览</b><p>可靠的知识系统将阅读、结构化保存和可引用检索连接起来。</p></Card><div className="panel-spacer"/><Button type="primary" block icon={<SaveOutlined/>} onClick={()=>void save()}>保存到知识库</Button><Input className="ask-input" placeholder="询问当前页面…" suffix={<ArrowRightOutlined/>}/></aside>}
