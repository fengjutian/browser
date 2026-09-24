import { MouseEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AutoComplete, Badge, Button, Dropdown, Input, message, Modal, Popover, Segmented, Select, Space, Tabs, Tag, Tooltip, Typography, UI_MODAL_OVERLAY_EVENT, type InputRef, type MenuProps } from '../../components/ui'
import { ArrowDownOutlined, ArrowLeftOutlined, ArrowRightOutlined, ArrowUpOutlined, AudioMutedOutlined, BookOutlined, CheckCircleOutlined, CloseCircleOutlined, CloseOutlined, CopyOutlined, DownloadOutlined, FullscreenOutlined, GlobalOutlined, LoadingOutlined, MoreOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, SafetyCertificateOutlined, SaveOutlined, SearchOutlined, SoundOutlined, StarFilled, StarOutlined, ThunderboltOutlined, TranslationOutlined, WarningOutlined } from '../../components/ui/icons'
import { Sparkles as RobotOutlined } from 'lucide-react'
import type { BrowserTab, BrowserTabError } from '../../types'
import { addBrowserHistory, deleteClosedTab, findDocumentByUrl, getBrowserShortcutsEnabled, getBrowserWorkspace, getDocument, listBrowserHistory, listClosedTabs, listSitePermissions, recordReadingActivity, saveBrowserWorkspace, saveClosedTab, saveDocument, setSession, toggleStarred } from '../../api'
import { captureNativePage, clearNativePageData, closeNativeTab, editNativePage, ensureNativeTab, findInNativeTab, hasNativeTab, hideNativeTab, isNativeBrowserAvailable, navigateHistory, onNativeAdBlockUpdate, onNativeAudioState, onNativeNewTab, onNativeToolbarMenuAction, openNativeTab, printNativeTab, readNativeState, reloadNativeTab, resizeNativeTab, setNativeMuted, setNativeToolbarMenu, setNativeToolbarPanel, showNativeTab, stopNativeTab, zoomNativeTab } from '../../services/nativeBrowser'
import { extractArticle } from '../../features/reader/extractArticle'
import type { ReaderArticle } from '../../features/reader/types'
import { classifySaveError } from '../../features/documents/saveClassifier'
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue'
import { dedupeHistory, HISTORY_CHANGE_EVENT, parseHistory, removeHistoryEntry, type HistoryEntry } from '../../features/history/dedupeHistory'
import { reorderTabs } from '../../features/browser/reorderTabs'
import { groupTabsByOrigin, idsToCloseForSameDomain } from '../../features/browser/tabGrouping'
import { planLruSweep, type DownloadActivity } from '../../features/browser/lruPolicy'
import { computeResourceStats } from '../../features/browser/resourceStats'
import { useProcessMemory } from '../../features/browser/useProcessMemory'
import { formatBytes as formatProcessBytes } from '../../services/processMemory'
import { interpretShortcut, readShortcutOverrides } from '../../features/browser/shortcuts'
import { popClosedTab, recordClosedTab, type ClosedTab } from '../../features/browser/closedTabs'
import { AssistantPanel } from '../../features/ai/AssistantPanel'
import { classifyNavigationInput, renderSearchTemplate, resolveNavigationInput } from '../../features/browser/navigation'
import { useDownloads } from '../../features/downloads/useDownloads'
import { useDownloadQueue } from '../../features/downloads/useDownloadQueue'
import { saveWorkspace, snapshotTabsToPayload, getWorkspace, type WorkspaceRecord } from '../../services/workspaces'
import { restoreTabsFromWorkspace } from '../../features/browser/restoreWorkspace'
import { WORKSPACE_RESTORE_EVENT } from '../../features/browser/workspaces'
import { useTabRuntime } from '../../features/browser/useTabRuntime'
import { buildAddressSuggestions } from '../../features/browser/addressSuggestions'
import { DownloadSummary } from '../../features/downloads/DownloadCenter'
import { ContextMenu } from '../../features/browser/ContextMenuView'
import type { ContextMenuAction } from '../../features/browser/contextMenu'
import { startDownload } from '../../services/downloads'
import { classifyDownload } from '../../features/downloads/dangerClassifier'
import { shellOpen } from '../../services/webviewCompat'
import { classifyShellOpenUrl, describeScheme } from '../../features/browser/externalSchemes'
import { redactUrl } from '../../features/browser/logRedaction'
import { usePermissionPrompt } from '../../features/browser/usePermissionPrompt'
import { PermissionPromptBar } from '../../features/browser/PermissionPromptBar'
import { CertificateErrorBar } from '../../features/browser/CertificateErrorBar'
import { useCertificatePrompt } from '../../features/browser/useCertificatePrompt'
import { TabSearchPalette } from '../../features/browser/TabSearchPalette'
import { HistorySearchPalette } from '../../features/history/HistorySearchPalette'
import { BookmarkSearchPalette } from '../../features/bookmarks/BookmarkSearchPalette'
import { useBookmarks } from '../../features/bookmarks/useBookmarks'
import { BulkSummaryPalette } from '../../features/ai/BulkSummaryPalette'
import type { BulkProgressEntry } from '../../features/ai/bulkSummary'
import { NotesPanel } from '../../features/notes/NotesPanel'
import { addNote as appendNoteEntry, readNotes as loadStoredNotes, removeNote as dropNoteEntry, updateNote as patchNoteEntry, writeNotes as persistNotes, type NoteEntry } from '../../features/notes/notes'
import { isPrivateTab, makePrivateTab, stripPrivateTabs, resetPrivateSessionPermissions } from '../../features/browser/privateTabs'
import { readSitePermissions, writeSitePermissions } from '../../features/browser/sitePermissions'
import { forceAllDenyFor } from '../../features/browser/usePermissionPrompt'
import { LockOutlined } from '../../components/ui/icons'
import { readRecoverySnapshot, restoreFromSnapshot, writeSnapshot, type SessionSnapshot } from '../../features/browser/sessionStore'
import { RecoveryPanel, type RecoveryChoice } from '../../features/browser/RecoveryPanel'
import { dropSessionLock, getSessionLockState, type SessionLockState } from '../../services/session'
import { toggleFullscreen as toggleWindowFullscreen } from '../../services/webviewCompat'
import { buildSuggestions, trimSuggestions, type SuggestionItem } from '../../features/browser/suggestionProvider'
import { readSearchEngineConfig, resolveActiveSearchTemplate, SEARCH_ENGINE_PRESETS } from '../../features/browser/searchEngine'
import { evaluateUrlSafety, highestLevel, type SafetyIssue, type SafetyLevel } from '../../features/browser/urlSafety'
import { ADVANCED_SETTINGS_EVENT, readAdvancedSettings, type AdvancedSettings } from '../../features/settings/advanced'
import { cleanTrackingParameters, isTrackingCleanerEnabled, TRACKING_CLEANER_EVENT } from '../../features/plugins/trackingCleaner'
import { AD_BLOCKER_EVENT, isAdBlockerEnabled } from '../../features/plugins/adBlocker'

const SESSION_KEY = 'browser.tabs'
const SESSION_DEBOUNCE_MS = 500
type ToolbarOverlay = 'downloads' | 'bookmarks' | 'resources' | 'menu' | 'tab-menu'

// Native child WebViews are always composited above the React window on
// Windows. Keep enough room for toolbar popovers instead of hiding the whole
// page (which made opening the browser menu look like a blank-page failure).
const TOOLBAR_OVERLAY_INSET: Partial<Record<ToolbarOverlay, number>> = {}
const TAB_GROUP_PALETTE = ['#a7dfbd', '#9bc6e8', '#dfc0a7', '#c8a7df', '#dfb5b5', '#bce0c6']
const tabGroupColor = (id: string | null | undefined): string => {
  if (!id) return 'transparent'
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return TAB_GROUP_PALETTE[hash % TAB_GROUP_PALETTE.length]
}

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

function getSessionLegacy(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
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

const SOURCE_LABELS: Record<SuggestionItem['source'], string> = {
  'open-tab': '已打开',
  history: '历史',
  bookmark: '书签',
  search: '搜索',
}

function renderSuggestion(item: SuggestionItem) {
  const sourceLabel = SOURCE_LABELS[item.source]
  return (
    <div className="address-suggestion">
      <b>{item.title || item.url}</b>
      <small>{item.url}</small>
      <span className={`address-suggestion__source address-suggestion__source--${item.source}`}>{sourceLabel}</span>
    </div>
  )
}

export function BrowserPage({ visible = true, onSearchKnowledge }: { visible?: boolean; onSearchKnowledge?: (query: string) => void }) {
  const [tabs, setTabs] = useState<BrowserTab[]>([newTab('new')])
  const [activeTabId, setActiveTabId] = useState('new')
  const [address, setAddress] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [aiInitialQuestion, setAiInitialQuestion] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const [pendingShellOpen, setPendingShellOpen] = useState<string | null>(null)
  const [tabSearchOpen, setTabSearchOpen] = useState(false)
  const [historySearchOpen, setHistorySearchOpen] = useState(false)
  const [bookmarkPaletteOpen, setBookmarkPaletteOpen] = useState(false)
  const [bulkSummaryOpen, setBulkSummaryOpen] = useState(false)
  const [bulkSummaryBusy, setBulkSummaryBusy] = useState(false)
  const [bulkSummaryProgress, setBulkSummaryProgress] = useState<BulkProgressEntry[]>([])
  const [notes, setNotes] = useState<NoteEntry[]>(() => loadStoredNotes())
  const [notesOpen, setNotesOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findStatus, setFindStatus] = useState<'idle' | 'found' | 'missing'>('idle')
  const [zoomLevels, setZoomLevels] = useState<Record<string, number>>({})
  const { downloads } = useDownloads({
    onTerminal: entry => {
      if (entry.status === 'completed') messageApi.success('下载完成')
      else if (entry.status === 'failed') messageApi.error('下载失败')
    },
  })
  const downloadQueue = useDownloadQueue({ runningDownloads: downloads })
  const permissionPrompt = usePermissionPrompt()
  const certificatePrompt = useCertificatePrompt()
  const bookmarkActions = useBookmarks()
  const [readerArticle, setReaderArticle] = useState<ReaderArticle | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [closedTabs, setClosedTabs] = useState<ClosedTab[]>([])
  const [starredDocId, setStarredDocId] = useState<string | null>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [messageApi, contextHolder] = message.useMessage()
  const [lockState, setLockState] = useState<SessionLockState | null>(null)
  const [recoveredTabs, setRecoveredTabs] = useState<BrowserTab[]>([])
  const [recoveredActiveId, setRecoveredActiveId] = useState<string>('')
  const [recoveredScroll, setRecoveredScroll] = useState<Record<string, { x: number; y: number }>>({})
  const [recoveredZoom, setRecoveredZoom] = useState<Record<string, number>>({})
  const [advancedSettings, setAdvancedSettings] = useState<AdvancedSettings>(readAdvancedSettings)
  const [trackingCleanerEnabled, setTrackingCleanerEnabledState] = useState(isTrackingCleanerEnabled)
  const [adBlockerEnabled, setAdBlockerEnabledState] = useState(isAdBlockerEnabled)
  const [blockedAdsByTab, setBlockedAdsByTab] = useState<Record<string, number>>({})
  const [toolbarOverlay, setToolbarOverlay] = useState<ToolbarOverlay | null>(null)
  const [modalOverlayCount, setModalOverlayCount] = useState(0)
  const [sourceView, setSourceView] = useState<{ url: string; html: string } | null>(null)
  const [clearSiteDataOpen, setClearSiteDataOpen] = useState(false)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<InputRef>(null)
  const previousTab = useRef<string | undefined>(undefined)
  const activeTabIdRef = useRef(activeTabId)
  const tabsRef = useRef(tabs)
  const closedTabsRef = useRef(closedTabs)
  const historyRef = useRef(history)
  const zoomLevelsRef = useRef(zoomLevels)
  const downloadsRef = useRef(downloads)
  const visibleRef = useRef(visible)
  // Do not let the default blank tab overwrite a crash snapshot while the
  // recovery dialog is waiting for the user's decision.
  const recoveryPendingRef = useRef(false)
  const lastActiveAtRef = useRef(new Map<string, number>([['new', Date.now()]]))
  const lastHistoryUrl = useRef<string>('')
  const shortcutsEnabledRef = useRef(getBrowserShortcutsEnabled())
  const active = tabs.find(tab => tab.id === activeTabId) ?? tabs[0]
  const nativeMode = hasNativeTab(active.id)
  const searchTemplate = useMemo(() => resolveActiveSearchTemplate(readSearchEngineConfig()), [])
  const addressSuggestions = useMemo(() => {
    const built = buildSuggestions({
      query: address,
      openTabs: tabs.map(tab => ({ url: tab.url, title: tab.title })),
      history,
      bookmarks: [],
      searchTemplate,
    })
    const trimmed = trimSuggestions(built, 8)
    return trimmed.map(item => ({
      value: item.url,
      label: renderSuggestion(item),
    }))
  }, [address, history, tabs, searchTemplate])
  const safetyIssues = useMemo<SafetyIssue[]>(() => evaluateUrlSafety(address), [address])
  const safetyLevel: SafetyLevel = highestLevel(safetyIssues)
  const showSafety = advancedSettings.safetyWarnings && safetyLevel !== 'safe' && address.trim().length > 0

  function changeToolbarOverlay(kind: ToolbarOverlay, open: boolean) {
    if (open) { setToolbarOverlay(kind); return }
    setToolbarOverlay(current => current === kind ? null : current)
  }

  useEffect(() => {
    if (!visible || readerArticle || !hasNativeTab(active.id)) return
    if (modalOverlayCount > 0 || toolbarOverlay === 'tab-menu') {
      void hideNativeTab(active.id)
      return
    }
    const next = bounds()
    const inset = toolbarOverlay ? TOOLBAR_OVERLAY_INSET[toolbarOverlay] ?? 0 : 0
    if (next && inset > 0) {
      void resizeNativeTab(active.id, { ...next, width: Math.max(1, next.width - inset) })
        .then(() => showNativeTab(active.id))
      return
    }
    if (next) void resizeNativeTab(active.id, next).then(() => showNativeTab(active.id))
    else void showNativeTab(active.id)
  }, [active.id, modalOverlayCount, readerArticle, toolbarOverlay, visible])

  useEffect(() => {
    const onModalOverlayChange = (event: Event) => {
      const delta = Number((event as CustomEvent<number>).detail)
      if (Number.isFinite(delta)) setModalOverlayCount(current => Math.max(0, current + delta))
    }
    window.addEventListener(UI_MODAL_OVERLAY_EVENT, onModalOverlayChange)
    return () => window.removeEventListener(UI_MODAL_OVERLAY_EVENT, onModalOverlayChange)
  }, [])

  useEffect(() => {
    const onAdvancedChange = (event: Event) => setAdvancedSettings((event as CustomEvent<AdvancedSettings>).detail)
    const onCleanerChange = (event: Event) => setTrackingCleanerEnabledState((event as CustomEvent<boolean>).detail)
    const onAdBlockerChange = (event: Event) => setAdBlockerEnabledState((event as CustomEvent<boolean>).detail)
    window.addEventListener(ADVANCED_SETTINGS_EVENT, onAdvancedChange)
    window.addEventListener(TRACKING_CLEANER_EVENT, onCleanerChange)
    window.addEventListener(AD_BLOCKER_EVENT, onAdBlockerChange)
    return () => {
      window.removeEventListener(ADVANCED_SETTINGS_EVENT, onAdvancedChange)
      window.removeEventListener(TRACKING_CLEANER_EVENT, onCleanerChange)
      window.removeEventListener(AD_BLOCKER_EVENT, onAdBlockerChange)
    }
  }, [])

  useEffect(() => {
    let unlisten: () => void = () => undefined
    void onNativeAdBlockUpdate(update => {
      const tabId = update.tabLabel.replace(/^browser-/, '')
      setBlockedAdsByTab(current => ({ ...current, [tabId]: update.blockedCount }))
    }).then(dispose => { unlisten = () => { dispose() } })
    return () => unlisten()
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      listBrowserHistory(),
      listClosedTabs(),
      getSessionLockState(),
      getBrowserWorkspace(),
      listSitePermissions(),
    ]).then(([storedHistory, storedClosedTabs, lockState, workspace, permissions]) => {
      if (cancelled) return
      if (permissions.length > 0) writeSitePermissions(permissions)
      else {
        const legacyPermissions = readSitePermissions()
        if (legacyPermissions.length > 0) writeSitePermissions(legacyPermissions)
      }
      setHistory(storedHistory)
      setClosedTabs(storedClosedTabs)
      const crash = lockState?.crashed ?? false
      const snapshot = readRecoverySnapshot()
      const restored = snapshot ? restoreFromSnapshot(snapshot.snapshot) : null
      if (crash && restored && restored.tabs.some(tab => tab.url.trim().length > 0)) {
        recoveryPendingRef.current = true
        setLockState(lockState)
        setRecoveredTabs(restored.tabs)
        setRecoveredActiveId(restored.activeTabId)
        setRecoveredScroll(restored.scrollPositions)
        setRecoveredZoom(restored.zoomLevels)
        return
      }
      const parsed = workspace ?? parsePersistedSession(getSessionLegacy(SESSION_KEY))
      if (parsed) {
        setTabs(parsed.tabs)
        setActiveTabId(parsed.activeTabId)
        const activeTab = parsed.tabs.find(tab => tab.id === parsed.activeTabId)
        setAddress(activeTab?.url ?? '')
        if (activeTab?.url) lastHistoryUrl.current = activeTab.url
      }
      setHistory(storedHistory)
      setClosedTabs(storedClosedTabs)
      setHydrated(true)
      if (parsed) {
        void (async () => {
          await new Promise(resolve => requestAnimationFrame(resolve))
          if (cancelled) return
          const nextBounds = bounds()
          if (!nextBounds) return
          await Promise.all(parsed.tabs.filter(tab => tab.url && (!tab.suspended || tab.id === parsed.activeTabId)).map(async tab => {
            try {
              const opened = await ensureNativeTab(tab.id, tab.url, nextBounds, { private: tab.private })
              if (!opened) {
                setTabs(current => current.map(item => item.id === tab.id ? { ...item, error: { kind: 'web-mode-required', message: '网页浏览仅在 Tauri 桌面应用中可用。' } } : item))
                return
              }
              if (tab.id === parsed.activeTabId && visibleRef.current) await showNativeTab(tab.id)
              else await hideNativeTab(tab.id)
            } catch (error) {
              setTabs(current => current.map(item => item.id === tab.id ? { ...item, error: { kind: 'load-failed', message: String(error) } } : item))
            }
          }))
          await enforceLiveTabLimit(parsed.activeTabId)
        })()
      }
    })
    return () => { cancelled = true }
  }, [])

  const sessionJson = useDebouncedValue(JSON.stringify({ tabs: stripPrivateTabs(tabs), activeTabId }), SESSION_DEBOUNCE_MS)
  useEffect(() => {
    if (!hydrated || recoveryPendingRef.current) return
    void setSession(SESSION_KEY, sessionJson)
    void saveBrowserWorkspace({ tabs: stripPrivateTabs(tabs), activeTabId })
    const snapshot: SessionSnapshot = {
      schemaVersion: 2,
      savedAt: Date.now(),
      windows: [{
        id: 'main',
        tabs: stripPrivateTabs(tabs),
        activeTabId,
        scrollPositions: Object.fromEntries(
          tabsRef.current
            .filter(tab => !tab.private && typeof tab.scrollX === 'number' && typeof tab.scrollY === 'number')
            .map(tab => [tab.id, { x: tab.scrollX ?? 0, y: tab.scrollY ?? 0 }])
        ),
        zoomLevels: zoomLevelsRef.current,
      }],
      history: historyRef.current,
      closedTabs: closedTabsRef.current,
    }
    writeSnapshot(snapshot)
  }, [sessionJson, hydrated])

  useEffect(() => {
    if (!hydrated || !active.url || active.url === lastHistoryUrl.current) return
    if (isPrivateTab(active)) return
    lastHistoryUrl.current = active.url
    const entry = { url: redactUrl(active.url), title: active.title, visitedAt: Date.now() }
    setHistory(current => dedupeHistory(current, entry))
    void addBrowserHistory(entry).catch(() => undefined)
  }, [active.url, active.title, active.private, hydrated])

  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])
  useEffect(() => { tabsRef.current = tabs }, [tabs])
  useEffect(() => { persistNotes(notes) }, [notes])
  useEffect(() => { closedTabsRef.current = closedTabs }, [closedTabs])
  useEffect(() => { downloadsRef.current = downloads }, [downloads])
  useEffect(() => { historyRef.current = history }, [history])
  useEffect(() => {
    const syncHistory = (event: Event) => setHistory((event as CustomEvent<HistoryEntry[]>).detail)
    window.addEventListener(HISTORY_CHANGE_EVENT, syncHistory)
    return () => window.removeEventListener(HISTORY_CHANGE_EVENT, syncHistory)
  }, [])
  useEffect(() => { zoomLevelsRef.current = zoomLevels }, [zoomLevels])
  useEffect(() => { visibleRef.current = visible }, [visible])

  useEffect(() => {
    const open = (event: Event) => {
      const url = (event as CustomEvent<{ url?: string }>).detail?.url
      if (url && /^https?:\/\//.test(url)) openNewTab(url)
    }
    window.addEventListener('arcadia-browser-open-url', open)
    return () => window.removeEventListener('arcadia-browser-open-url', open)
  }, [])

  useEffect(() => {
    if (!visible || active.private || active.loading || !/^https?:\/\//.test(active.url)) return
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const current = tabsRef.current.find(tab => tab.id === active.id)
      if (!current || current.private || current.loading || !/^https?:\/\//.test(current.url)) return
      void recordReadingActivity({ url: current.url, title: current.title || current.url, activeSeconds: 5, scrollDepth: current.scrollDepth ?? 0 }).catch(() => undefined)
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [active.id, active.url, active.loading, active.private, visible])

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
    if (hasNativeTab(active.id)) {
      if (visible) {
        if (modalOverlayCount > 0 || toolbarOverlay === 'tab-menu') {
          void hideNativeTab(active.id)
        } else {
          void showNativeTab(active.id)
          requestAnimationFrame(() => {
            const next = bounds()
            if (!next) return
            const inset = toolbarOverlay ? TOOLBAR_OVERLAY_INSET[toolbarOverlay] ?? 0 : 0
            void resizeNativeTab(active.id, { ...next, width: Math.max(1, next.width - inset) })
          })
        }
      } else {
        void hideNativeTab(active.id)
      }
    }
  }, [active.id, modalOverlayCount, toolbarOverlay, visible])

  const tabRuntime = useTabRuntime({
    tab: active,
    visible,
    enabled: nativeMode && hasNativeTab(active.id),
    onApply: (patch) => {
      setTabs(current => current.map(tab => tab.id === active.id ? { ...tab, ...patch, crashed: false } : tab))
      if (typeof patch.url === 'string') setAddress(patch.url)
    },
    onReopen: () => {
      const tab = tabsRef.current.find(item => item.id === active.id)
      const nextBounds = bounds()
      if (!tab?.url || !nextBounds) return
      tabRuntime.enqueueScroll(tab.id, { x: tab.scrollX ?? 0, y: tab.scrollY ?? 0 })
      setTabs(current => current.map(item => item.id === tab.id ? { ...item, crashed: true, loading: true, error: undefined } : item))
      void openNativeTab(tab.id, tab.url, nextBounds, { private: tab.private }).catch(error => {
        setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, crashed: true, error: classifyNavigationError(error) } : item))
      })
    },
  })

  useEffect(() => {
    if (!surfaceRef.current || !visible) return
    const observer = new ResizeObserver(() => {
      const next = bounds()
      if (!next || modalOverlayCount > 0 || toolbarOverlay === 'tab-menu') return
      const inset = toolbarOverlay ? TOOLBAR_OVERLAY_INSET[toolbarOverlay] ?? 0 : 0
      void resizeNativeTab(active.id, { ...next, width: Math.max(1, next.width - inset) })
    })
    observer.observe(surfaceRef.current)
    return () => observer.disconnect()
  }, [active.id, aiOpen, findOpen, modalOverlayCount, toolbarOverlay, visible])

  useEffect(() => () => { tabsRef.current.forEach(tab => { void closeNativeTab(tab.id) }) }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void onNativeNewTab((url, options) => openNewTab(url, options)).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => { disposed = true; unlisten?.() }
  }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void onNativeAudioState(state => {
      if (disposed) return
      setTabs(current => current.map(tab => tab.id === state.tabId
        ? { ...tab, audible: state.audible, muted: state.muted }
        : tab))
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => { disposed = true; unlisten?.() }
  }, [])

  useEffect(() => {
    if (hasNativeTab(active.id)) void setNativeMuted(active.id, active.muted === true)
  }, [active.id, active.muted])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!visibleRef.current) return
      if (!shortcutsEnabledRef.current) return
      const action = interpretShortcut(event, readShortcutOverrides())
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
        case 'find':
          setFindOpen(true)
          return
        case 'openTabSearch':
          setTabSearchOpen(true)
          return
        case 'openHistorySearch':
          setHistorySearchOpen(true)
          return
        case 'openBookmarks':
          setBookmarkPaletteOpen(true)
          return
        case 'addBookmark':
          void addCurrentAsBookmark()
          return
        case 'openBulkSummary':
          setBulkSummaryOpen(true)
          return
        case 'toggleNotesPanel':
          setNotesOpen(value => !value)
          return
        case 'saveWorkspace':
          void saveAsWorkspace()
          return
        case 'print':
          if (hasNativeTab(activeTabIdRef.current)) void printNativeTab(activeTabIdRef.current)
          return
        case 'zoomIn':
          changeZoom(activeTabIdRef.current, 0.1)
          return
        case 'zoomOut':
          changeZoom(activeTabIdRef.current, -0.1)
          return
        case 'zoomReset':
          setZoom(activeTabIdRef.current, 1)
          return
        case 'reload':
          if (hasNativeTab(activeTabIdRef.current)) void reloadNativeTab(activeTabIdRef.current)
          return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('arcadia-shortcuts-change', onShortcutsChange)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('arcadia-shortcuts-change', onShortcutsChange)
    }
  }, [])

  // Workspace restore is requested from the Settings page via a custom event;
  // BrowserPage is the only place that owns the live tab list, so the swap
  // happens here.
  useEffect(() => {
    async function onRestoreWorkspace(event: Event) {
      const detail = (event as CustomEvent<{ id: string }>).detail
      if (!detail?.id) return
      const workspace = await getWorkspace(detail.id)
      if (!workspace) {
        messageApi.error('工作区不存在或已删除')
        return
      }
      await applyWorkspaceRestore(workspace)
    }
    window.addEventListener(WORKSPACE_RESTORE_EVENT, onRestoreWorkspace)
    return () => window.removeEventListener(WORKSPACE_RESTORE_EVENT, onRestoreWorkspace)
  }, [])

  function onShortcutsChange(event: Event) {
    const detail = (event as CustomEvent<{ enabled: boolean }>).detail
    shortcutsEnabledRef.current = detail.enabled !== false
  }

  async function navigate(input: string) {
    const resolved = resolveNavigationInput(input, { searchTemplate })
    if (!resolved) return
    const url = trackingCleanerEnabled ? cleanTrackingParameters(resolved) : resolved
    const tabId = active.id
    if (!isNativeBrowserAvailable()) {
      window.open(url, '_blank', 'noopener,noreferrer')
      setTabs(current => current.map(tab => tab.id === tabId ? { ...newTab(tab.id), active: true } : tab))
      setAddress('')
      messageApi.info('网页预览模式下已使用系统浏览器打开')
      return
    }
    // Private tabs always deny sensitive permissions for the target origin.
    // The script-level guard enforces this at runtime; pre-denying here
    // ensures the JS prompt is skipped too.
    if (active.private) {
      try {
        const origin = new URL(url).origin
        if (origin && origin !== 'null') forceAllDenyFor(origin)
      } catch { /* ignore non-http inputs */ }
    }
    setReaderArticle(null)
    setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, url, title: input.trim(), loading: true, error: undefined, crashed: false } : tab))
    await new Promise(resolve => requestAnimationFrame(resolve))
    const nextBounds = bounds()
    if (!nextBounds) return
    try {
      const opened = await openNativeTab(tabId, url, nextBounds, { private: active.private })
      if (!opened) {
        setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, loading: false, error: { kind: 'web-mode-required', message: '网页浏览仅在 Tauri 桌面应用中可用。' } } : tab))
        return
      }
      setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, error: undefined } : tab))
      await enforceLiveTabLimit(tabId)
    } catch (error) {
      setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, loading: false, error: classifyNavigationError(error) } : tab))
    }
  }

  async function enforceLiveTabLimit(protectedId: string) {
    const tabs = tabsRef.current
    const liveIds = new Set(tabs.filter(tab => hasNativeTab(tab.id)).map(tab => tab.id))
    const currentSettings = readAdvancedSettings()
    const activeDownloads: DownloadActivity[] = downloadsRef.current
      .filter(item => item.status === 'downloading')
      .map(item => ({ status: 'downloading', sourceOrigin: item.sourceOrigin }))
    const idleThresholdMs = Math.max(1, currentSettings.idleSuspendMinutes) * 60_000
    const plan = planLruSweep({
      tabs,
      liveIds,
      lastActiveAt: lastActiveAtRef.current,
      activeDownloads,
      protectedId,
      maxLive: currentSettings.maxLiveWebviews,
      idleThresholdMs,
    })
    for (const id of plan.toClose) {
      const tab = tabs.find(item => item.id === id)
      try {
        const state = await readNativeState(id)
        if (state) setTabs(current => current.map(item => item.id === id ? { ...item, scrollX: Math.round(state.scrollX), scrollY: Math.round(state.scrollY) } : item))
      } catch { /* retain the last observed position */ }
      await closeNativeTab(id)
      setTabs(current => current.map(item => item.id === id ? { ...item, suspended: true, loading: false } : item))
      if (tab?.url) {
        try {
          const origin = new URL(tab.url).origin
          if (origin && origin !== 'null') forceAllDenyFor(origin)
        } catch { /* ignore non-http urls */ }
      }
    }
  }

  async function resumeTab(tab: BrowserTab) {
    if (!tab.url || hasNativeTab(tab.id)) return
    const nextBounds = bounds()
    if (!nextBounds) return
    setTabs(current => current.map(item => item.id === tab.id ? { ...item, suspended: false, loading: true, error: undefined } : item))
    try {
      tabRuntime.enqueueScroll(tab.id, { x: tab.scrollX ?? 0, y: tab.scrollY ?? 0 })
      const opened = await ensureNativeTab(tab.id, tab.url, nextBounds, { private: tab.private })
      if (!opened) throw new Error('网页浏览仅在 Tauri 桌面应用中可用。')
      if (visibleRef.current && activeTabIdRef.current === tab.id) await showNativeTab(tab.id)
      setTabs(current => current.map(item => item.id === tab.id ? { ...item, suspended: false, error: undefined } : item))
      await enforceLiveTabLimit(tab.id)
    } catch (error) {
      setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: { kind: 'load-failed', message: String(error) } } : item))
    }
  }

  function setZoom(tabId: string, scale: number) {
    const next = Math.min(3, Math.max(0.5, Math.round(scale * 10) / 10))
    setZoomLevels(current => ({ ...current, [tabId]: next }))
    if (hasNativeTab(tabId)) void zoomNativeTab(tabId, next)
  }

  function changeZoom(tabId: string, delta: number) {
    setZoomLevels(current => {
      const next = Math.min(3, Math.max(0.5, Math.round(((current[tabId] ?? 1) + delta) * 10) / 10))
      if (hasNativeTab(tabId)) void zoomNativeTab(tabId, next)
      return { ...current, [tabId]: next }
    })
  }

  async function runFind(backwards = false) {
    if (!findQuery || !hasNativeTab(active.id)) { setFindStatus('idle'); return }
    try {
      setFindStatus(await findInNativeTab(active.id, findQuery, backwards) ? 'found' : 'missing')
    } catch {
      setFindStatus('missing')
    }
  }

  function closeFind() {
    if (hasNativeTab(active.id)) void findInNativeTab(active.id, '')
    setFindOpen(false)
    setFindStatus('idle')
  }

  const [isWindowFullscreen, setIsWindowFullscreen] = useState(false)
  async function handleToggleFullscreen() {
    const next = await toggleWindowFullscreen()
    setIsWindowFullscreen(next)
  }
  function runBrowserMenuAction(action: string) {
    switch (action) {
      case 'find': setFindOpen(true); break
      case 'tab-search': setTabSearchOpen(true); break
      case 'history-search': setHistorySearchOpen(true); break
      case 'bookmark-add': void addCurrentAsBookmark(); break
      case 'bookmarks': setBookmarkPaletteOpen(true); break
      case 'bulk-summary': setBulkSummaryOpen(true); break
      case 'toggle-notes': setNotesOpen(value => !value); break
      case 'save-workspace': void saveAsWorkspace(); break
      case 'print': void printNativeTab(active.id); break
      case 'new-private': openNewTab(undefined, { private: true }); break
      case 'fullscreen': void handleToggleFullscreen(); break
      case 'zoom-out': changeZoom(active.id, -0.1); break
      case 'zoom-in': changeZoom(active.id, 0.1); break
      case 'zoom-reset': setZoom(active.id, 1); break
      case 'clear-site-data': setClearSiteDataOpen(true); break
    }
  }

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void onNativeToolbarMenuAction(({ tabId, action, value }) => {
      if (disposed || tabId !== activeTabIdRef.current) return
      if (action === 'bookmark-open' && value) void navigate(value)
      else if (action !== '__dismiss__') runBrowserMenuAction(action)
      if (!action.startsWith('zoom-') || action === 'zoom-reset') setToolbarOverlay(null)
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => { disposed = true; unlisten?.() }
  })

  function toggleBrowserMenu() {
    const open = toolbarOverlay !== 'menu'
    setToolbarOverlay(open ? 'menu' : null)
    void setNativeToolbarMenu(active.id, open, Math.round((zoomLevels[active.id] ?? 1) * 100)).catch(() => {
      setToolbarOverlay(null)
      messageApi.error('菜单浮层加载失败，请重启桌面应用后重试')
    })
  }

  useEffect(() => {
    if (!nativeMode) return
    const isMenuTrigger = (event: Event) => event.target instanceof Element && !!event.target.closest('button[aria-label="浏览器菜单"]')
    const stopPointerDown = (event: Event) => {
      if (isMenuTrigger(event)) event.stopImmediatePropagation()
    }
    const interceptClick = (event: Event) => {
      if (!isMenuTrigger(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      toggleBrowserMenu()
    }
    document.addEventListener('pointerdown', stopPointerDown, true)
    document.addEventListener('click', interceptClick, true)
    return () => {
      document.removeEventListener('pointerdown', stopPointerDown, true)
      document.removeEventListener('click', interceptClick, true)
    }
  }, [active.id, nativeMode, toolbarOverlay, zoomLevels])

  const browserMenu: MenuProps['items'] = ([
    { key: 'find', label: '在页面中查找', extra: 'Ctrl+F', onClick: () => runBrowserMenuAction('find') },
    { key: 'tab-search', label: '搜索标签页', extra: 'Ctrl+K', onClick: () => runBrowserMenuAction('tab-search') },
    { key: 'history-search', label: '浏览历史记录', extra: 'Ctrl+H', onClick: () => runBrowserMenuAction('history-search') },
    { key: 'bookmark-add', label: '收藏当前页', extra: 'Ctrl+D', onClick: () => runBrowserMenuAction('bookmark-add') },
    { key: 'bookmarks', label: '打开收藏夹', extra: 'Ctrl+Shift+O', onClick: () => runBrowserMenuAction('bookmarks') },
    { key: 'bulk-summary', label: '多链接 AI 摘要', extra: 'Ctrl+Shift+S', onClick: () => runBrowserMenuAction('bulk-summary') },
    { key: 'toggle-notes', label: '网页笔记面板', extra: 'Ctrl+Shift+N', onClick: () => runBrowserMenuAction('toggle-notes') },
    { key: 'save-workspace', label: '保存当前标签为工作区', extra: 'Ctrl+Shift+W', icon: <SaveOutlined/>, disabled: tabs.length === 0, onClick: () => runBrowserMenuAction('save-workspace') },
    { key: 'print', label: '打印', icon: <PrinterOutlined/>, extra: 'Ctrl+P', disabled: !nativeMode, onClick: () => runBrowserMenuAction('print') },
    { key: 'clear-site-data', label: '清除此网站数据', disabled: !active.url || !nativeMode, onClick: () => runBrowserMenuAction('clear-site-data') },
    { type: 'divider' },
    { key: 'new-private', label: '新建私密窗口', icon: <LockOutlined/>, extra: 'Shift+Ctrl+N', onClick: () => runBrowserMenuAction('new-private') },
    { key: 'fullscreen', label: isWindowFullscreen ? '退出全屏' : '进入全屏', icon: <FullscreenOutlined/>, extra: 'F11', onClick: () => runBrowserMenuAction('fullscreen') },
    { type: 'divider' },
    { key: 'zoom', label: <Space><Button size="small" onClick={event => { event.stopPropagation(); changeZoom(active.id, -0.1) }}>−</Button><span className="browser-zoom-value">{Math.round((zoomLevels[active.id] ?? 1) * 100)}%</span><Button size="small" onClick={event => { event.stopPropagation(); changeZoom(active.id, 0.1) }}>+</Button></Space> },
    { key: 'zoom-reset', label: '重置缩放', extra: 'Ctrl+0', onClick: () => setZoom(active.id, 1) },
  ]) as MenuProps['items']

  const bookmarkBarPanel = (
    <div className="bookmark-bar-panel" role="menu">
      {bookmarkActions.bookmarks.length === 0
        ? <Typography.Text type="secondary">还没有收藏，Ctrl+D 收藏当前页</Typography.Text>
        : <ul>
            {bookmarkActions.bookmarks.slice(0, 8).map(bookmark => (
              <li key={bookmark.id}>
                <button type="button" title={bookmark.url} onClick={() => void navigate(bookmark.url)}>
                  <span className="bookmark-bar-panel__title">{bookmark.title}</span>
                  <Typography.Text type="secondary" className="bookmark-bar-panel__url">{bookmark.url}</Typography.Text>
                </button>
              </li>
            ))}
            {bookmarkActions.bookmarks.length > 8 && <li><button type="button" onClick={() => setBookmarkPaletteOpen(true)}>查看全部 {bookmarkActions.bookmarks.length} 条…</button></li>}
          </ul>}
    </div>
  )

  const downloadPanel = (
    <DownloadSummary
      feed={downloads.map(item => ({ ...item, targetPath: item.targetPath ?? item.path }))}
      inFlight={downloads.filter(item => item.status === 'downloading').length}
      pendingCount={downloadQueue.pending.length}
      maxConcurrent={downloadQueue.maxConcurrent}
    />
  )

  const resourceStats = useMemo(() => {
    const liveIds = new Set(tabs.filter(tab => hasNativeTab(tab.id)).map(tab => tab.id))
    const downloadingOrigins = new Set(downloads.filter(item => item.status === 'downloading').map(item => item.sourceOrigin).filter((value): value is string => !!value))
    return computeResourceStats({ tabs, liveIds, downloadingOrigins, lastActiveAt: lastActiveAtRef.current })
  }, [tabs, downloads])

  const processMemory = useProcessMemory({ enabled: nativeMode })
  const memory = processMemory.snapshot

  const nativePanelPayloads = useMemo(() => ({
    bookmarks: {
      total: bookmarkActions.bookmarks.length,
      items: bookmarkActions.bookmarks.slice(0, 8).map(bookmark => ({ title: bookmark.title, url: bookmark.url })),
    },
    downloads: {
      subtitle: downloads.some(item => item.status === 'downloading')
        ? `${downloads.filter(item => item.status === 'downloading').length} 个正在下载 / 上限 ${downloadQueue.maxConcurrent}`
        : downloadQueue.pending.length > 0 ? `${downloadQueue.pending.length} 个排队中` : '暂无活动',
      items: downloads.slice(0, 5).map(item => ({
        name: item.fileName || item.url.split('/').pop() || '下载文件',
        status: item.status,
        detail: item.totalBytes
          ? `${item.status} · ${Math.min(100, Math.round(((item.receivedBytes ?? 0) / item.totalBytes) * 100))}%`
          : item.status,
      })),
    },
    resources: {
      sections: [
        { title: '标签页', items: [
          { label: '总标签页', value: resourceStats.totalTabs },
          { label: '活跃 WebView', value: resourceStats.liveTabs },
          { label: '已休眠', value: resourceStats.suspendedTabs },
          { label: '固定', value: resourceStats.pinnedTabs },
          { label: '播放音频', value: resourceStats.audibleTabs },
          { label: '下载中', value: resourceStats.downloadingTabs },
          { label: '最久未活跃', value: `${resourceStats.idleMinutes} 分钟` },
        ]},
        { title: '进程内存', items: [
          { label: '工作集', value: formatProcessBytes(memory?.workingSetBytes) },
          { label: '提交大小', value: formatProcessBytes(memory?.commitBytes) },
          { label: '峰值', value: formatProcessBytes(memory?.peakWorkingSetBytes) },
          { label: '缺页中断', value: memory?.pageFaultCount == null ? '—' : memory.pageFaultCount.toLocaleString('zh-CN') },
        ]},
      ],
      hint: `LRU 阈值 ${advancedSettings.maxLiveWebviews} 个 WebView；空闲 ${advancedSettings.idleSuspendMinutes} 分钟自动休眠。`,
    },
  }), [advancedSettings.idleSuspendMinutes, advancedSettings.maxLiveWebviews, bookmarkActions.bookmarks, downloadQueue.maxConcurrent, downloadQueue.pending.length, downloads, memory, resourceStats])

  useEffect(() => {
    if (!nativeMode) return
    const triggerKinds: Record<string, 'downloads' | 'bookmarks' | 'resources'> = {
      下载: 'downloads',
      收藏夹: 'bookmarks',
      资源面板: 'resources',
    }
    const kindFor = (event: Event) => {
      if (!(event.target instanceof Element)) return undefined
      const button = event.target.closest<HTMLButtonElement>('button[aria-label]')
      return button ? triggerKinds[button.getAttribute('aria-label') ?? ''] : undefined
    }
    const stopPointerDown = (event: Event) => { if (kindFor(event)) event.stopImmediatePropagation() }
    const interceptClick = (event: Event) => {
      const kind = kindFor(event)
      if (!kind) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const open = toolbarOverlay !== kind
      setToolbarOverlay(open ? kind : null)
      void setNativeToolbarPanel(active.id, open, kind, nativePanelPayloads[kind]).catch(() => {
        setToolbarOverlay(null)
        messageApi.error('浮层加载失败，请重启桌面应用后重试')
      })
    }
    document.addEventListener('pointerdown', stopPointerDown, true)
    document.addEventListener('click', interceptClick, true)
    return () => {
      document.removeEventListener('pointerdown', stopPointerDown, true)
      document.removeEventListener('click', interceptClick, true)
    }
  }, [active.id, nativeMode, nativePanelPayloads, toolbarOverlay])

  useEffect(() => {
    if (!nativeMode || !toolbarOverlay || toolbarOverlay === 'menu' || toolbarOverlay === 'tab-menu') return
    void setNativeToolbarPanel(active.id, true, toolbarOverlay, nativePanelPayloads[toolbarOverlay])
  }, [active.id, nativeMode, nativePanelPayloads, toolbarOverlay])

  const resourcePanel = (
    <div className="resource-panel" role="status">
      <Typography.Text type="secondary" className="resource-panel__title">资源面板</Typography.Text>
      <ul>
        <li><span>总标签页</span><b>{resourceStats.totalTabs}</b></li>
        <li><span>活跃 WebView</span><b>{resourceStats.liveTabs}</b></li>
        <li><span>已休眠</span><b>{resourceStats.suspendedTabs}</b></li>
        <li><span>固定</span><b>{resourceStats.pinnedTabs}</b></li>
        <li><span>播放音频</span><b>{resourceStats.audibleTabs}</b></li>
        <li><span>下载中</span><b>{resourceStats.downloadingTabs}</b></li>
        <li><span>最久未活跃</span><b>{resourceStats.idleMinutes} 分钟</b></li>
      </ul>
      <Typography.Text type="secondary" className="resource-panel__title resource-panel__title--sub">进程内存</Typography.Text>
      <ul className="resource-panel__memory">
        <li><span>工作集</span><b>{formatProcessBytes(memory?.workingSetBytes)}</b></li>
        <li><span>提交大小</span><b>{formatProcessBytes(memory?.commitBytes)}</b></li>
        <li><span>峰值</span><b>{formatProcessBytes(memory?.peakWorkingSetBytes)}</b></li>
        <li>
          <span>缺页中断</span>
          <b>{memory?.pageFaultCount == null ? '—' : memory.pageFaultCount.toLocaleString('zh-CN')}</b>
        </li>
      </ul>
      {processMemory.unsupported && (
        <Typography.Paragraph type="secondary" className="resource-panel__hint">
          当前平台未提供进程内存查询
        </Typography.Paragraph>
      )}
      <Typography.Paragraph type="secondary" className="resource-panel__hint">
        LRU 阈值 {advancedSettings.maxLiveWebviews} 个 WebView；空闲 {advancedSettings.idleSuspendMinutes} 分钟自动休眠；进程内存每 5 秒刷新。
      </Typography.Paragraph>
    </div>
  )

  async function retryActive() {
    const url = active.url
    if (!url) return
    await navigate(url)
  }

  const [saveWorkspaceOpen, setSaveWorkspaceOpen] = useState(false)
  const [saveWorkspaceName, setSaveWorkspaceName] = useState('')
  const [saveWorkspaceDescription, setSaveWorkspaceDescription] = useState('')

  function openSaveWorkspaceDialog() {
    if (tabs.length === 0) {
      messageApi.warning('当前没有可保存的标签页')
      return
    }
    const stamp = new Date()
    const stampLabel = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')} ${String(stamp.getHours()).padStart(2, '0')}:${String(stamp.getMinutes()).padStart(2, '0')}`
    setSaveWorkspaceName(`工作区 ${stampLabel}`)
    setSaveWorkspaceDescription('')
    setSaveWorkspaceOpen(true)
  }

  async function saveAsWorkspace() {
    openSaveWorkspaceDialog()
  }

  async function confirmSaveWorkspace() {
    const name = saveWorkspaceName.trim()
    if (!name) {
      messageApi.warning('请填写工作区名称')
      return
    }
    if (name.length > 80) {
      messageApi.warning('名称最多 80 个字符')
      return
    }
    try {
      const summary = await saveWorkspace({
        name,
        description: saveWorkspaceDescription.trim(),
        payload: snapshotTabsToPayload(tabs),
      })
      messageApi.success(`已保存工作区「${summary.name}」(${summary.tabCount} 个标签)`)
      setSaveWorkspaceOpen(false)
    } catch (error) {
      messageApi.error(`保存失败：${String(error)}`)
    }
  }

  async function applyWorkspaceRestore(workspace: WorkspaceRecord) {
    const result = restoreTabsFromWorkspace(tabs, workspace)
    if (result.tabs.length === 0) {
      messageApi.warning('工作区为空')
      return
    }
    setTabs(result.tabs)
    setActiveTabId(result.activeTabId)
    // Re-create native tabs for the entries that did not previously exist
    // (i.e. those marked loading=true by the restore) so WebView2 actually
    // opens them. Existing tabs keep their native handles.
    const newOnes = result.tabs.filter(tab => tab.loading && tab.url && !hasNativeTab(tab.id))
    const nextBounds = bounds()
    if (nextBounds) {
      await Promise.all(newOnes.map(async tab => {
        try {
          const opened = await openNativeTab(tab.id, tab.url!, nextBounds, { private: tab.private })
          if (!opened) {
            setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: { kind: 'web-mode-required', message: '网页浏览仅在 Tauri 桌面应用中可用。' } } : item))
            return
          }
          setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: undefined } : item))
        } catch (error) {
          setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, crashed: true, error: { kind: 'load-failed', message: String(error) } } : item))
        }
      }))
    } else {
      setTabs(current => current.map(item => item.loading ? { ...item, loading: false } : item))
    }
    void enforceLiveTabLimit(result.activeTabId)
    messageApi.success(`已恢复工作区（+${result.addedCount} / −${result.removedCount}）`)
  }

  async function retryTab(id: string) {
    const target = tabsRef.current.find(item => item.id === id)
    if (!target?.url) return
    setTabs(current => current.map(item => item.id === id ? { ...item, crashed: false, loading: true, error: undefined } : item))
    const nextBounds = bounds()
    if (!nextBounds) return
    try {
      await openNativeTab(target.id, target.url, nextBounds, { private: target.private })
      await enforceLiveTabLimit(target.id)
    } catch (error) {
      setTabs(current => current.map(item => item.id === id ? { ...item, loading: false, error: classifyNavigationError(error) } : item))
    }
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

  async function writeClipboard(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      messageApi.success(`已复制${label}`)
    } catch {
      messageApi.error(`复制${label}失败`)
    }
  }

  async function handleRecovery(choice: RecoveryChoice) {
    await dropSessionLock()
    recoveryPendingRef.current = false
    // Hydration completes only after a decision, so the first persisted
    // snapshot contains the chosen tabs (or the intentional blank session).
    setHydrated(true)
    if (choice === 'discard') {
      setLockState(null)
      setRecoveredTabs([])
      return
    }
    const next = choice === 'pinned'
      ? recoveredTabs.filter(tab => tab.pinned)
      : recoveredTabs
    if (next.length === 0) {
      setLockState(null)
      setRecoveredTabs([])
      return
    }
    setTabs(next)
    const activeId = next.find(tab => tab.id === recoveredActiveId)?.id
      ?? next[0]?.id
      ?? 'new'
    setActiveTabId(activeId)
    const active = next.find(tab => tab.id === activeId)
    setAddress(active?.url ?? '')
    setZoomLevels(recoveredZoom)
    if (active?.url) lastHistoryUrl.current = active.url
    setLockState(null)
    setRecoveredTabs([])
    void new Promise(resolve => requestAnimationFrame(resolve)).then(async () => {
      const nextBounds = bounds()
      if (!nextBounds) return
      // Lazy: only mount the active tab WebView; everything else stays
      // `suspended` until the user clicks them (handled by resumeTab).
      await Promise.all(next.filter(tab => tab.url && tab.id === activeId).map(async tab => {
        try {
          const opened = await ensureNativeTab(tab.id, tab.url, nextBounds, { private: tab.private })
          if (!opened) return
          tabRuntime.enqueueScroll(tab.id, { x: recoveredScroll[tab.id]?.x ?? 0, y: recoveredScroll[tab.id]?.y ?? 0 })
          if (visibleRef.current) await showNativeTab(tab.id)
        } catch { /* skip */ }
      }))
      await enforceLiveTabLimit(activeId)
    })
  }

  async function handleContextAction(action: ContextMenuAction, request: { linkUrl: string | null; imageUrl: string | null; selectionText: string }) {
  if (action === 'add-to-notes') {
    const text = request.selectionText?.trim()
    if (!text) { messageApi.info('请先选中文本'); return }
    const entry: Omit<NoteEntry, 'id' | 'createdAt'> = {
      url: active.url ?? '',
      title: active.title ?? active.url ?? '未命名页面',
      text,
      comment: '',
    }
    setNotes(current => appendNoteEntry(current, entry))
    setNotesOpen(true)
    messageApi.success('已加入笔记', 2)
    return
  }
    switch (action) {
      case 'back': void navigateHistory(active.id, -1); return
      case 'forward': void navigateHistory(active.id, 1); return
      case 'reload': if (hasNativeTab(active.id)) void reloadNativeTab(active.id); return
      case 'stop': if (hasNativeTab(active.id)) void stopNativeTab(active.id); return
      case 'print': if (hasNativeTab(active.id)) void printNativeTab(active.id); return
      case 'view-source':
        try { setSourceView(await captureNativePage(active.id)) }
        catch (error) { messageApi.error(`无法读取页面源代码：${String(error)}`) }
        return
      case 'copy': await writeClipboard(request.selectionText ?? '', '选区'); return
      case 'cut':
      case 'paste':
      case 'select-all':
        try { await editNativePage(active.id, action) }
        catch (error) { messageApi.error(`编辑操作失败：${String(error)}`) }
        return
      case 'search-selection': if (request.selectionText) void navigate(`https://www.google.com/search?q=${encodeURIComponent(request.selectionText)}`); return
      case 'ask-ai':
        await openReader()
        setAiInitialQuestion(request.selectionText ? `请解释这段内容：\n\n${request.selectionText}` : '')
        setAiOpen(true)
        return
      case 'open-link-current': if (request.linkUrl) void navigate(request.linkUrl); return
      case 'open-link-new': if (request.linkUrl) openNewTab(request.linkUrl); return
      case 'open-link-external': if (request.linkUrl) {
        const verdict = classifyShellOpenUrl(request.linkUrl)
        if (verdict.shellOpenable) setPendingShellOpen(request.linkUrl)
        else if (!verdict.irreversible) openNewTab(request.linkUrl)
      }
      return
      case 'copy-link': if (request.linkUrl) await writeClipboard(request.linkUrl, '链接'); return
      case 'open-image-new': if (request.imageUrl) openNewTab(request.imageUrl); return
      case 'copy-image': if (request.imageUrl) await writeClipboard(request.imageUrl, '图片地址'); return
      case 'save-image':
        if (request.imageUrl) {
          try {
            const derivedName = (() => {
              try { return new URL(request.imageUrl!).pathname.split('/').pop() || 'image' }
              catch { return 'image' }
            })()
            await startDownload({
              id: crypto.randomUUID(),
              url: request.imageUrl,
              fileName: derivedName,
              mimeType: undefined,
              dangerType: classifyDownload({ fileName: derivedName }),
              sourceOrigin: request.imageUrl ? new URL(request.imageUrl).origin : undefined,
              sourceTabLabel: active.id,
            })
            messageApi.success('图片加入下载队列')
          } catch (error) {
            messageApi.error(`保存失败：${String(error)}`)
          }
        }
        return
    }
  }

  function openNewTab(url?: string, options: { private?: boolean } = {}) {
    if (url && !isNativeBrowserAvailable()) {
      window.open(url, '_blank', 'noopener,noreferrer')
      messageApi.info('网页预览模式下已使用系统浏览器打开')
      return
    }
    const tab = options.private ? makePrivateTab() : newTab()
    const currentId = activeTabIdRef.current
    if (currentId) void hideNativeTab(currentId)
    if (url) { tab.url = url; tab.title = '正在加载…'; tab.loading = true }
    setTabs(current => {
      const next = current.map(item => ({ ...item, active: false }))
      return [...next, tab]
    })
    activeTabIdRef.current = tab.id
    lastActiveAtRef.current.set(tab.id, Date.now())
    setActiveTabId(tab.id)
    setAddress(url ?? '')
    setReaderArticle(null)
    if (url) {
      void new Promise(resolve => requestAnimationFrame(resolve)).then(async () => {
        const nextBounds = bounds()
        if (!nextBounds) return
        try {
          const opened = await openNativeTab(tab.id, url, nextBounds, { private: tab.private })
          if (!opened) {
            setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: { kind: 'web-mode-required', message: '网页浏览仅在 Tauri 桌面应用中可用。' } } : item))
            return
          }
          setTabs(current => current.map(item => item.id === tab.id ? { ...item, error: undefined } : item))
          await enforceLiveTabLimit(tab.id)
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
    lastActiveAtRef.current.set(id, Date.now())
    setAddress(selected?.url ?? '')
    setReaderArticle(null)
    if (selected?.suspended || (selected?.url && !hasNativeTab(id))) void resumeTab(selected)
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

  function toggleMuted(id: string) {
    const target = tabsRef.current.find(tab => tab.id === id)
    if (!target) return
    const nextMuted = !target.muted
    setTabs(current => current.map(tab => tab.id === id
      ? { ...tab, muted: nextMuted, audible: nextMuted ? false : tab.audible }
      : tab))
    void setNativeMuted(id, nextMuted).catch(() => {
      setTabs(current => current.map(tab => tab.id === id ? { ...tab, muted: target.muted } : tab))
      messageApi.error('无法修改网页音频状态')
    })
  }

  function closeDomain(anchorId: string) {
    const targets = idsToCloseForSameDomain(tabs, anchorId)
    if (!targets.length) return
    closeTabs(targets)
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
    const sameDomainCount = idsToCloseForSameDomain(tabs, tab.id).length
    const items: NonNullable<MenuProps['items']> = [
      { key: 'reload', label: '重新加载', disabled: !hasNativeTab(tab.id), onClick: () => void reloadNativeTab(tab.id) },
      { key: 'duplicate', label: '复制标签页', disabled: !tab.url, onClick: () => duplicateTab(tab) },
      { key: 'pin', label: tab.pinned ? '取消固定' : '固定标签页', onClick: () => togglePinned(tab.id) },
      { key: 'mute', label: tab.muted ? '取消静音此标签页' : '静音此标签页', onClick: () => toggleMuted(tab.id) },
      { type: 'divider' },
      { key: 'close', label: '关闭标签页', disabled: tab.pinned, onClick: () => closeTab(tab.id) },
      { key: 'close-others', label: '关闭其他标签页', disabled: tabs.length < 2, onClick: () => closeTabs(tabs.filter(item => item.id !== tab.id && !item.pinned).map(item => item.id)) },
      { key: 'close-right', label: '关闭右侧标签页', disabled: index === tabs.length - 1, onClick: () => closeTabs(tabs.slice(index + 1).filter(item => !item.pinned).map(item => item.id)) },
      { key: 'close-domain', label: sameDomainCount > 0 ? `关闭同域标签页（${sameDomainCount} 个）` : '关闭同域标签页', disabled: sameDomainCount === 0, onClick: () => closeDomain(tab.id) },
    ]
    if (tab.crashed) {
      items.unshift({ key: 'reopen', label: '重新打开崩溃的标签页', onClick: () => void retryTab(tab.id) })
      items.splice(1, 0, { type: 'divider', key: 'crashed-divider' })
    }
    if (tab.private) {
      const insertAt = items.findIndex(item => item && 'key' in item && item.key === 'close-domain')
      const dividerAt = insertAt > 0 ? insertAt + 1 : items.length
      items.splice(dividerAt, 0, { type: 'divider', key: 'private-divider' })
      items.push({ key: 'private-info', label: '私密窗口：不会写入历史与会话', disabled: true })
    }
    return items
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
    lastActiveAtRef.current.delete(id)
    const closing = tabs.find(tab => tab.id === id)
    const wasPrivate = isPrivateTab(closing)
    if (closing && closing.url && !wasPrivate) {
      const entry: ClosedTab = { id: closing.id, url: closing.url, title: closing.title, favicon: closing.favicon, closedAt: Date.now() }
      setClosedTabs(current => recordClosedTab(current, entry))
      void saveClosedTab(entry)
    }
    const closedIndex = tabs.findIndex(tab => tab.id === id)
    const remaining = tabs.filter(tab => tab.id !== id)
    // Last private tab closed → wipe its accumulated permission rules so the
    // session leaves no trace.
    if (wasPrivate) {
      const stillPrivate = remaining.filter(tab => isPrivateTab(tab))
      if (stillPrivate.length === 0 && closing?.url) {
        try {
          const origin = new URL(closing.url).origin
          resetPrivateSessionPermissions([origin])
        } catch { /* ignore malformed urls */ }
      }
    }
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

  async function addCurrentAsBookmark() {
    const url = active.url
    if (!url) { messageApi.warning('当前标签页没有可收藏的网址'); return }
    try {
      await bookmarkActions.add({
        id: crypto.randomUUID(),
        url,
        title: active.title || url,
        favicon: active.favicon ?? null,
      })
      messageApi.success('已加入收藏夹', 2)
    } catch (error) {
      messageApi.error(`加入收藏夹失败：${String(error)}`)
    }
  }

  async function runBulkSummary(urls: string[], kind: 'one-sentence' | 'short' | 'detailed' | 'key-points') {
    const { aiChat: sendChat } = await import('../../api')
    const { extractArticle } = await import('../../features/reader/extractArticle')
    const { buildSummaryPrompt } = await import('../../features/ai/summarize')
    const { listAIProviders } = await import('../../api')
    const providers = await listAIProviders().catch(() => [])
    const providerId = providers[0]?.id
    if (!providerId) { messageApi.error('尚未配置 AI Provider'); return [] }
    const entries: Array<{ index: number; total: number; url: string; title: string; status: 'fetched' | 'summarised' | 'skipped' | 'failed'; documentId?: string; message?: string }> = []
    const titles: string[] = []
    const partials: string[] = []
    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index]!
      try {
        const response = await fetch(url, { mode: 'cors' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const html = await response.text()
        const article = extractArticle({ url, html })
        if (!article.markdown?.trim()) {
          entries.push({ index, total: urls.length, url, title: url, status: 'skipped', message: '正文为空' })
          continue
        }
        const request = buildSummaryPrompt(article.markdown, kind, article.title)
        const summaryResponse = await sendChat(providerId, request)
        const summary = summaryResponse.content
        const saved = await saveDocument({ title: `摘要：${article.title || url}`, url, markdown: `# ${article.title}\n\n来源：${url}\n\n## 摘要\n\n${summary}\n\n## 正文\n\n${article.markdown}`, tags: ['bulk-summary', kind] })
        entries.push({ index, total: urls.length, url, title: article.title, status: 'summarised', documentId: saved.id })
        titles.push(article.title)
        partials.push(summary)
      } catch (error) {
        entries.push({ index, total: urls.length, url, title: url, status: 'failed', message: String(error) })
      }
    }
    if (titles.length > 1) {
      try {
        const crossPrompt = {
          messages: [
            { role: 'system', content: 'You merge multiple article summaries into one coherent cross-article summary. Never invent facts. Respond in the documents\' primary language.' },
            { role: 'user', content: `Articles:\n\n${titles.map((title, i) => `## ${title}\n\n${partials[i] ?? ''}`).join('\n\n---\n\n')}\n\n---\n\nWrite a structured cross-article summary that links the topics together. Use markdown headings.` },
          ],
          temperature: 0.2,
        }
        const cross = await sendChat(providerId, crossPrompt)
        const aggregated = `# 多链接综述（${titles.length} 条）\n\n${cross.content}\n\n## 各篇摘要\n\n${titles.map((title, i) => `### ${title}\n\n${partials[i] ?? ''}`).join('\n\n')}`
        const saved = await saveDocument({ title: aggregatedTitleFor(titles), url: urls[0] ?? '', markdown: aggregated, tags: ['multi-summary', kind] })
        messageApi.success(`多链接综述已存入知识库（${titles.length} 条）`, 3)
        void saved
      } catch (error) {
        messageApi.warning(`交叉综述生成失败：${String(error)}`)
      }
    } else if (titles.length === 1) {
      messageApi.success(`已存入 1 条摘要`, 2)
    }
    return entries
  }

  function aggregatedTitleFor(titles: string[]) {
    return titles.length > 1 ? `多链接综述（${titles.length} 条）` : titles[0] ?? '多链接综述'
  }

  function reopenLastClosed() {
    const result = popClosedTab(closedTabsRef.current)
    if (!result) return
    setClosedTabs(result.remaining)
    const restored = result.popped
    void deleteClosedTab(restored.id)
    const tab: BrowserTab = {
      id: crypto.randomUUID(),
      url: restored.url,
      title: restored.title || '正在加载…',
      favicon: restored.favicon,
      loading: true,
      active: true,
      pinned: false,
    }
    setTabs(current => {
      const next = current.map(item => ({ ...item, active: false }))
      return [...next, tab]
    })
    activeTabIdRef.current = tab.id
    setActiveTabId(tab.id)
    setAddress(restored.url)
    setReaderArticle(null)
    void new Promise(resolve => requestAnimationFrame(resolve)).then(async () => {
      const nextBounds = bounds()
      if (!nextBounds) return
      try {
        await ensureNativeTab(tab.id, restored.url, nextBounds, { private: tab.private })
        if (activeTabIdRef.current === tab.id) await showNativeTab(tab.id)
        setTabs(current => current.map(item => item.id === tab.id ? { ...item, error: undefined } : item))
        await enforceLiveTabLimit(tab.id)
      } catch (error) {
        setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: { kind: 'load-failed', message: String(error) } } : item))
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
    <div className="browser-tabs" style={{ '--tab-count': tabs.length } as CSSProperties}><Tabs type="editable-card" items={(() => {
          const groupDecisions = groupTabsByOrigin(tabs)
          return tabs.map((tab, index) => {
          const isDragging = draggingIndex === index
          const isDropTarget = dragOverIndex === index && draggingIndex !== null && draggingIndex !== index
          const group = groupDecisions[index]
          const groupColor = tabGroupColor(group.groupId)
          return {
            key: tab.id,
            label: <Dropdown menu={{ items: tabMenu(tab, index) }} trigger={['contextMenu']} onOpenChange={open => changeToolbarOverlay('tab-menu', open)}>
              <Tooltip title={tab.url || (tab.private ? '新私密窗口' : '新标签页')} mouseEnterDelay={0.6}>
              <span
                draggable
                onAuxClick={event => { if (event.button === 1 && !tab.pinned) closeTab(tab.id) }}
                onDragStart={onTabDragStart(index)}
                onDragOver={onTabDragOver(index)}
                onDrop={onTabDrop(index)}
                onDragEnd={onTabDragEnd}
                className={`browser-tab-title${isDragging ? ' is-dragging' : ''}${isDropTarget ? ' is-drop-target' : ''}${tab.private ? ' browser-tab-title--private' : ''}`}
              >{tab.crashed ? <WarningOutlined aria-label="标签页崩溃" className="browser-tab-crash"/> : tab.loading ? <LoadingOutlined spin/> : tab.private ? <LockOutlined /> : tab.favicon ? <img src={tab.favicon} alt=""/> : <GlobalOutlined/>}{tab.muted ? <Tooltip title="已静音" mouseEnterDelay={0.6}><AudioMutedOutlined aria-label="已静音" className="browser-tab-audio"/></Tooltip> : tab.audible ? <Tooltip title="正在播放音频" mouseEnterDelay={0.6}><SoundOutlined aria-label="正在播放音频" className="browser-tab-audio"/></Tooltip> : null}<span>{tab.title}</span></span>
              </Tooltip>
            </Dropdown>,
            style: group.groupId ? ({ '--tab-group-color': groupColor } as CSSProperties) : undefined,
            className: `${tab.pinned ? 'browser-tab--pinned ' : ''}${tab.suspended ? 'browser-tab--suspended' : ''}${tab.private ? ' browser-tab--private' : ''}${tab.muted ? ' browser-tab--muted' : ''}${tab.crashed ? ' browser-tab--crashed' : ''}${group.groupId ? ' browser-tab--grouped' : ''}`.trim() || undefined,
            closable: tabs.length > 1 && !tab.pinned,
          }
        })})()} activeKey={activeTabId} onChange={activateTab} addIcon={<Tooltip title="新建标签页 (Ctrl+T)"><PlusOutlined aria-label="新建标签页"/></Tooltip>} onEdit={(target, action) => action === 'add' ? openNewTab() : closeTab(String(target))}/></div>
    <div className="browser-toolbar"><Space><Button type="text" aria-label="后退" title="后退 (Alt+←)" icon={<ArrowLeftOutlined/>} disabled={!nativeMode || !active.canGoBack} onClick={() => void navigateHistory(active.id,-1)}/><Button type="text" aria-label="前进" title="前进 (Alt+→)" icon={<ArrowRightOutlined/>} disabled={!nativeMode || !active.canGoForward} onClick={() => void navigateHistory(active.id,1)}/><Button type="text" aria-label={active.loading?'停止加载':'重新加载'} title={active.loading?'停止加载 (Esc)':'重新加载 (F5)'} icon={active.loading?<CloseOutlined/>:<ReloadOutlined/>} disabled={!nativeMode} onClick={() => void (active.loading ? stopNativeTab(active.id) : reloadNativeTab(active.id))}/><Button type="text" icon={<BookOutlined/>} onClick={() => void openReader()}>阅读模式</Button></Space><form onSubmit={event => { event.preventDefault(); void navigate(address) }}><AutoComplete value={address} options={addressSuggestions} onChange={setAddress} onSelect={value=>void navigate(value)}><Input ref={addressRef} prefix={<SafetyCertificateOutlined/>} suffix={<button type="button" className={`browser-star${starredDocId ? ' is-active' : ''}`} disabled={!active.url} aria-label={starredDocId ? '取消收藏' : '收藏当前页'} title={starredDocId ? '取消收藏' : '收藏当前页'} onClick={event => { event.preventDefault(); event.stopPropagation(); void toggleStarCurrent() }}><StarOutlined/></button>} onFocus={event=>event.currentTarget.select()} placeholder="搜索或输入网址"/></AutoComplete></form><Tooltip title={adBlockerEnabled ? `广告过滤已开启，本标签已过滤 ${blockedAdsByTab[active.id] ?? 0} 项` : '广告过滤已关闭'}><Tag icon={<SafetyCertificateOutlined/>} color={adBlockerEnabled ? 'green' : 'default'}>{blockedAdsByTab[active.id] ?? 0}</Tag></Tooltip><Button type={aiOpen?'primary':'text'} ghost={aiOpen} icon={<RobotOutlined/>} onClick={()=>setAiOpen(value=>!value)}/><Popover trigger="click" placement="bottomRight" content={downloadPanel} open={toolbarOverlay==='downloads'} onOpenChange={open=>void changeToolbarOverlay('downloads',open)}><Badge size="small" count={downloads.filter(item=>item.status==='downloading').length}><Button type="text" aria-label="下载" icon={<DownloadOutlined/>}/></Badge></Popover><Popover trigger="click" placement="bottomRight" content={bookmarkBarPanel} open={toolbarOverlay==='bookmarks'} onOpenChange={open=>void changeToolbarOverlay('bookmarks',open)}><Button type="text" aria-label="收藏夹" title={`${bookmarkActions.bookmarks.length} 条收藏 (Ctrl+Shift+O)`} icon={<StarFilled style={{ color: bookmarkActions.bookmarks.length ? '#d49a26' : undefined }}/>}/></Popover><Popover trigger="click" placement="bottomRight" content={resourcePanel} open={toolbarOverlay==='resources'} onOpenChange={open=>void changeToolbarOverlay('resources',open)}><Button type="text" aria-label="资源面板" icon={<ThunderboltOutlined/>} title={`${resourceStats.liveTabs} 个 WebView / ${resourceStats.totalTabs} 标签`}/></Popover><Dropdown menu={{items:browserMenu}} trigger={['click']} open={toolbarOverlay==='menu'} onOpenChange={open=>void changeToolbarOverlay('menu',open)}><Button type="text" aria-label="浏览器菜单" icon={<MoreOutlined/>}/></Dropdown></div>
    {findOpen&&<div className="browser-find"><Input autoFocus allowClear prefix={<SearchOutlined/>} value={findQuery} status={findStatus==='missing'?'error':undefined} placeholder="在页面中查找" onChange={event=>{setFindQuery(event.target.value);setFindStatus('idle')}} onPressEnter={event=>void runFind(event.shiftKey)}/><Typography.Text type={findStatus==='missing'?'danger':'secondary'}>{findStatus==='missing'?'未找到':findStatus==='found'?'已定位':''}</Typography.Text><Button type="text" aria-label="上一个匹配项" icon={<ArrowUpOutlined/>} onClick={()=>void runFind(true)}/><Button type="text" aria-label="下一个匹配项" icon={<ArrowDownOutlined/>} onClick={()=>void runFind(false)}/><Button type="text" aria-label="关闭查找" icon={<CloseOutlined/>} onClick={closeFind}/></div>}
    <PermissionPromptBar prompt={permissionPrompt} />
    <TabSearchPalette
      open={tabSearchOpen}
      tabs={tabs}
      activeId={activeTabId}
      onClose={() => setTabSearchOpen(false)}
      onPick={id => activateTab(id)}
      onCloseTab={id => closeTab(id)}
    />
    <HistorySearchPalette
      open={historySearchOpen}
      history={history}
      onClose={() => setHistorySearchOpen(false)}
      onOpen={entry => void navigate(entry.url)}
      onRemove={entry => setHistory(current => removeHistoryEntry(current, entry.url).remaining)}
      onClear={() => setHistory([])}
    />
    <BookmarkSearchPalette
      open={bookmarkPaletteOpen}
      bookmarks={bookmarkActions.bookmarks}
      onClose={() => setBookmarkPaletteOpen(false)}
      onOpen={bookmark => void navigate(bookmark.url)}
      onRemove={bookmark => void bookmarkActions.remove(bookmark.id)}
      onUpdate={(bookmark, patch) => { void bookmarkActions.update(bookmark.id, patch) }}
    />
    <BulkSummaryPalette
      open={bulkSummaryOpen}
      busy={bulkSummaryBusy}
      progress={bulkSummaryProgress}
      onClose={() => { setBulkSummaryOpen(false); setBulkSummaryProgress([]) }}
      onRun={async (urls, kind) => {
        setBulkSummaryBusy(true)
        setBulkSummaryProgress([])
        try {
          const result = await runBulkSummary(urls, kind)
          setBulkSummaryProgress(result)
          return result
        } finally {
          setBulkSummaryBusy(false)
        }
      }}
    />
    <NotesPanel
      open={notesOpen}
      notes={notes}
      onToggle={() => setNotesOpen(value => !value)}
      onRemove={id => setNotes(current => dropNoteEntry(current, id))}
      onUpdate={(id, patch) => setNotes(current => patchNoteEntry(current, id, patch))}
    />
    <Modal
      title="保存工作区"
      open={saveWorkspaceOpen}
      onCancel={() => setSaveWorkspaceOpen(false)}
      onOk={() => void confirmSaveWorkspace()}
      okText="保存"
      cancelText="取消"
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">工作区会记住当前所有标签页的 URL、标题、固定/静音状态。点击保存后可在「设置 → 浏览器 → 工作区」中恢复或删除。</Typography.Paragraph>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>
          <Typography.Text strong>名称</Typography.Text>
          <Input
            value={saveWorkspaceName}
            onChange={event => setSaveWorkspaceName(event.target.value)}
            maxLength={80}
            placeholder="例如：工作日上午"
            autoFocus
          />
        </label>
        <label>
          <Typography.Text strong>描述（可选）</Typography.Text>
          <Input.TextArea
            value={saveWorkspaceDescription}
            onChange={event => setSaveWorkspaceDescription(event.target.value)}
            maxLength={240}
            rows={3}
            placeholder="这个工作区用来做什么？"
          />
        </label>
      </div>
    </Modal>
    {certificatePrompt.prompt && <CertificateErrorBar payload={certificatePrompt.prompt} onRespond={allow => void certificatePrompt.respond(allow)} />}
    <RecoveryPanel
      open={lockState !== null}
      state={lockState}
      onChoose={choice => void handleRecovery(choice)}
    />
    {showSafety && (
      <div className={`browser-safety-warn browser-safety-warn--${safetyLevel}`} role="status">
        <SafetyCertificateOutlined />
        <span>
          {safetyLevel === 'dangerous' ? '危险：' : '注意：'}
          {safetyIssues.map(issue => issue.message).join(' / ')}
        </span>
      </div>
    )}
    <div className="browser-content"><div className="web-surface" ref={surfaceRef}>{readerArticle
      ? <ReaderArticleView article={readerArticle}/>
      : active.crashed
        ? <BrowserErrorView tab={{...active, error:{kind:'load-failed',message:'此标签页的底层视图已停止响应，可点击"重新打开"恢复。'}}} onRetry={retryActive} onNewTab={openNewTab} onCopy={copyUrl}/>
        : active.error
          ? <BrowserErrorView tab={active} onRetry={retryActive} onNewTab={openNewTab} onCopy={copyUrl}/>
        : nativeMode
          ? null
          : active.loading
            ? <div className="web-surface__loading"><LoadingOutlined spin/></div>
            : active.url
              ? <BrowserErrorView tab={{...active, error:{kind:'web-mode-required',message:'当前网页需要在 Tauri 桌面应用中打开。'}}} onRetry={retryActive} onNewTab={openNewTab} onCopy={copyUrl}/>
              : <NewTab address={address} setAddress={setAddress} navigate={navigate} openNewTab={openNewTab} onSearchKnowledge={onSearchKnowledge}/>}</div>{aiOpen&&<AssistantPanel close={()=>setAiOpen(false)} saveToLibrary={save} currentUrl={active.url} currentTabId={active.id} readerArticle={readerArticle} initialQuestion={aiInitialQuestion}/>}</div>
    <ContextMenu
      surfaceRef={surfaceRef}
      capabilities={{
        canGoBack: !!active.canGoBack,
        canGoForward: !!active.canGoForward,
        canPrint: nativeMode,
        canAskAi: true,
      }}
      onAction={handleContextAction}
    />
    <Modal
      open={clearSiteDataOpen}
      title="清除此网站数据"
      okText="清除并重新加载"
      cancelText="取消"
      okButtonProps={{ danger: true }}
      onCancel={() => setClearSiteDataOpen(false)}
      onOk={async () => {
        try {
          await clearNativePageData(active.id)
          setClearSiteDataOpen(false)
          await reloadNativeTab(active.id)
          messageApi.success('已清除当前网页可访问的站点数据')
        } catch (error) { messageApi.error(`清除失败：${String(error)}`) }
      }}
    >
      <Typography.Paragraph>将清除当前网站的普通 Cookie、本地存储、会话存储、Cache Storage 和 IndexedDB，然后重新加载页面。</Typography.Paragraph>
      <Typography.Paragraph type="secondary">受 WebView2 接口限制，HTTP-only Cookie 和浏览器磁盘缓存可能仍需通过系统浏览器设置清理。</Typography.Paragraph>
    </Modal>
    <Modal
      open={sourceView !== null}
      title="页面源代码"
      footer={null}
      width="min(1100px, 92vw)"
      onCancel={() => setSourceView(null)}
      destroyOnHidden
    >
      {sourceView && <><Typography.Paragraph type="secondary" copyable>{sourceView.url}</Typography.Paragraph><pre style={{maxHeight:'70vh',overflow:'auto',whiteSpace:'pre-wrap',wordBreak:'break-word',padding:12,background:'#f6f8fa',borderRadius:8}}><code>{sourceView.html}</code></pre></>}
    </Modal>
    <Modal
      open={pendingShellOpen !== null}
      title="打开外部应用"
      okText="在系统应用中打开"
      cancelText="取消"
      onCancel={() => setPendingShellOpen(null)}
      onOk={async () => {
        const url = pendingShellOpen
        setPendingShellOpen(null)
        if (!url) return
        try { await shellOpen(url) } catch (error) { messageApi.error(`无法启动外部应用：${String(error)}`) }
      }}
    >
      {pendingShellOpen && (() => {
        const verdict = classifyShellOpenUrl(pendingShellOpen)
        return <>
            <Typography.Paragraph>即将离开浏览器，由 <b>{describeScheme(verdict.scheme)}</b> 处理：</Typography.Paragraph>
            <Typography.Text code className="browser-error__url">{pendingShellOpen}</Typography.Text>
          </>
      })()}
    </Modal>
  </div>
}

type SearchMode = 'web' | 'knowledge'

function NewTab({address,setAddress,navigate,openNewTab,onSearchKnowledge}:{address:string;setAddress:(value:string)=>void;navigate:(input:string)=>Promise<void>;openNewTab:(url?:string)=>void;onSearchKnowledge?: (query:string)=>void}) {
  const configuredEngine = readSearchEngineConfig().presetId
  const initialEngine = SEARCH_ENGINE_PRESETS.some(engine => engine.id === configuredEngine) ? configuredEngine : 'google'
  const [mode, setMode] = useState<SearchMode>('web')
  const [engines, setEngines] = useState<string[]>([initialEngine])
  const presets = SEARCH_ENGINE_PRESETS.map(item => ({ label: item.label, value: item.id }))
  const placeholder = mode === 'knowledge' ? '搜索本地知识库' : '搜索网页或输入 URL'

  function templateFor(id:string) { return SEARCH_ENGINE_PRESETS.find(item => item.id === id)?.template ?? SEARCH_ENGINE_PRESETS[0].template }
  function submit() {
    const query = address.trim()
    if (!query) return
    if (mode === 'knowledge') { onSearchKnowledge?.(query); return }
    if (classifyNavigationInput(query) !== 'search') { void navigate(query); return }
    const selected = engines.length ? engines : [initialEngine]
    const urls = selected.map(id => renderSearchTemplate(templateFor(id), query))
    void navigate(urls[0])
    urls.slice(1).forEach(url => openNewTab(url))
  }

  return <div className="new-tab"><div className="new-tab__hero"><Typography.Title>今天想探索什么？</Typography.Title><Typography.Paragraph>在网页与个人知识之间，选择最合适的探索方式。</Typography.Paragraph></div><div className="new-tab-search"><Segmented<SearchMode> block value={mode} onChange={setMode} options={[{label:'网页搜索',value:'web'},{label:'本地知识库',value:'knowledge'}]}/><form onSubmit={event=>{event.preventDefault();submit()}}><Input size="large" autoFocus prefix={<SearchOutlined/>} value={address} onChange={event=>setAddress(event.target.value)} placeholder={placeholder} suffix={<Button type="primary" htmlType="submit">{mode === 'knowledge' ? '查询' : '搜索'}</Button>}/></form>{mode === 'web' && <div className="search-engine-picker"><span>搜索引擎</span><Select mode="multiple" maxTagCount="responsive" value={engines} onChange={setEngines} options={presets} placeholder="选择一个或多个搜索引擎"/></div>}{mode === 'knowledge' && <div className="new-tab-search__hint">仅查询保存在本机的网页、笔记和标签，不会发送到外部搜索引擎。</div>}</div><div className="quick-sites"><div className="quick-sites__label">常用网站</div><div className="quick-sites__grid">{QUICK_SITES.map(site => <button key={site.url} type="button" className="quick-site" title={site.name} aria-label={`打开 ${site.name}`} onClick={(event:MouseEvent<HTMLButtonElement>)=>{event.currentTarget.blur();void navigate(site.url)}}><span className="quick-site__mark" style={{background:site.color}}>{site.initial}</span><span className="quick-site__name">{site.name}</span></button>)}</div></div></div>
}

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
