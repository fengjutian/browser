import { invoke } from '@tauri-apps/api/core'
import type { AIProvider, AIProviderType, ChatRequest, ChatResponse, Document, ProviderTestResult, Task } from './types'
import type { HistoryEntry } from './features/history/dedupeHistory'
import type { ClosedTab } from './features/browser/closedTabs'
import type { SitePermissionRule } from './features/browser/sitePermissions'
import type { BrowserTab, ReadingActivity } from './types'

const isTauri = () => '__TAURI_INTERNALS__' in window

async function localList(query = ''): Promise<Document[]> {
  return isTauri() ? invoke<Document[]>('local_list_documents', { query }) : []
}

async function localSave(document: Document): Promise<Document> {
  return isTauri() ? invoke<Document>('local_save_document', { document }) : document
}

export async function listDocuments(query = ''): Promise<Document[]> {
  return localList(query)
}

export async function saveDocument(input: { title: string; url: string; markdown: string; tags: string[] }): Promise<Document> {
  const localDocument = createDocument(input)
  return localSave(localDocument)
}

export async function getDocument(id: string): Promise<Document> {
  if (isTauri()) {
    const local = await invoke<Document | null>('local_get_document', { id })
    if (local) return local
  }
  throw new Error('Document unavailable')
}

export async function deleteDocument(id: string): Promise<void> {
  if (isTauri()) await invoke('local_delete_document', { id })
}

export async function toggleStarred(id: string, starred: boolean): Promise<boolean> {
  if (!isTauri()) throw new Error('Document unavailable')
  return invoke<boolean>('local_toggle_starred', { id, starred })
}

export interface UpdateDocumentInput {
  title?: string
  summary?: string
  tags?: string[]
  starred?: boolean
  status?: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | 'ARCHIVED'
}

export async function updateDocument(id: string, patch: UpdateDocumentInput): Promise<Document> {
  if (!isTauri()) throw new Error('Document unavailable')
  return invoke<Document>('local_update_document', { id, ...patch })
}

export async function updateTags(id: string, tags: string[]): Promise<void> {
  if (!isTauri()) return
  await invoke('local_update_tags', { id, tags })
}

export async function updateAutoTags(id: string, autoTags: string[]): Promise<void> {
  if (!isTauri()) return
  await invoke('local_update_auto_tags', { id, autoTags })
}

export async function archiveDocument(id: string): Promise<void> {
  if (!isTauri()) return
  await invoke('local_archive_document', { id })
}

export interface Collection {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  documentCount: number
}

export async function createCollection(name: string, description?: string): Promise<Collection> {
  if (!isTauri()) throw new Error('Document unavailable')
  return invoke<Collection>('local_create_collection', { name, description })
}

export async function listCollections(): Promise<Collection[]> {
  if (!isTauri()) return []
  return invoke<Collection[]>('local_list_collections')
}

export async function deleteCollection(id: string): Promise<void> {
  if (!isTauri()) return
  await invoke('local_delete_collection', { id })
}

export async function addToCollection(collectionId: string, documentId: string): Promise<void> {
  if (!isTauri()) return
  await invoke('local_add_to_collection', { collectionId, documentId })
}

export async function removeFromCollection(collectionId: string, documentId: string): Promise<void> {
  if (!isTauri()) return
  await invoke('local_remove_from_collection', { collectionId, documentId })
}

export async function listCollectionsForDocument(documentId: string): Promise<Collection[]> {
  if (!isTauri()) return []
  return invoke<Collection[]>('local_list_collections_for_document', { documentId })
}

export async function enqueueTask(input: { kind: string; documentId?: string; payload?: string; maxAttempts?: number }): Promise<Task> {
  if (!isTauri()) throw new Error('Document unavailable')
  return invoke<Task>('local_enqueue_task', input)
}

export async function claimPendingTask(): Promise<Task | null> {
  if (!isTauri()) return null
  return invoke<Task | null>('local_claim_pending_task')
}

export async function completeTask(id: string): Promise<void> {
  if (!isTauri()) return
  await invoke('local_complete_task', { id })
}

export async function failTask(id: string, error: string, backoffSeconds: number): Promise<void> {
  if (!isTauri()) return
  await invoke('local_fail_task', { id, error, backoffSeconds })
}

export async function recoverStaleTasks(timeoutSeconds: number): Promise<number> {
  if (!isTauri()) return 0
  return invoke<number>('local_recover_stale_tasks', { timeoutSeconds })
}

export async function retryTask(id: string): Promise<void> {
  if (!isTauri()) return
  await invoke('local_retry_task', { id })
}

export async function listRecentTasks(limit = 50): Promise<Task[]> {
  if (!isTauri()) return []
  return invoke<Task[]>('local_list_recent_tasks', { limit })
}

export interface AIProviderInput {
  id?: string
  type: AIProviderType
  baseUrl: string
  model: string
  embeddingModel?: string
  timeoutSeconds: number
  apiKey?: string
  clearApiKey?: boolean
}

export async function saveAIProvider(input: AIProviderInput): Promise<AIProvider> {
  if (!isTauri()) throw new Error('Document unavailable')
  return invoke<AIProvider>('local_save_ai_provider', {
    id: input.id,
    providerType: input.type,
    baseUrl: input.baseUrl,
    model: input.model,
    embeddingModel: input.embeddingModel,
    timeoutSeconds: input.timeoutSeconds,
    apiKey: input.apiKey,
    clearApiKey: input.clearApiKey ?? false,
  })
}

export async function listAIProviders(): Promise<AIProvider[]> {
  if (!isTauri()) return []
  return invoke<AIProvider[]>('local_list_ai_providers')
}

export async function getAIProvider(id: string): Promise<AIProvider | null> {
  if (!isTauri()) return null
  return invoke<AIProvider | null>('local_get_ai_provider', { id })
}

export async function deleteAIProvider(id: string): Promise<void> {
  if (!isTauri()) return
  await invoke('local_delete_ai_provider', { id })
}

export async function aiChat(providerId: string, request: ChatRequest): Promise<ChatResponse> {
  if (!isTauri()) throw new Error('Document unavailable')
  return invoke<ChatResponse>('ai_chat', { providerId, request })
}

export async function aiTestProvider(providerId: string): Promise<ProviderTestResult> {
  if (!isTauri()) throw new Error('Document unavailable')
  return invoke<ProviderTestResult>('ai_test_provider', { providerId })
}

export async function findDocumentByUrl(url: string): Promise<Document | null> {
  if (!isTauri()) return null
  return invoke<Document | null>('local_find_document_by_url', { url })
}

export async function getSession(key: string): Promise<string | null> {
  if (!isTauri()) return null
  return invoke<string | null>('local_get_session', { key })
}

export async function setSession(key: string, value: string): Promise<void> {
  if (!isTauri()) return
  await invoke('local_set_session', { key, value })
}

export async function listBrowserHistory(): Promise<HistoryEntry[]> {
  if (!isTauri()) {
    try { return JSON.parse(localStorage.getItem('browser.history') ?? '[]') as HistoryEntry[] }
    catch { return [] }
  }
  return invoke<HistoryEntry[]>('local_list_history')
}

export async function addBrowserHistory(entry: HistoryEntry): Promise<void> {
  if (!isTauri()) {
    const entries = await listBrowserHistory()
    localStorage.setItem('browser.history', JSON.stringify([entry, ...entries]))
    return
  }
  await invoke('local_add_history', { entry })
}

export async function recordReadingActivity(input: { url:string; title:string; activeSeconds:number; scrollDepth:number }): Promise<void> {
  if (isTauri()) await invoke('local_record_reading_activity', input)
}

export async function listReadingActivity(): Promise<ReadingActivity[]> {
  return isTauri() ? invoke<ReadingActivity[]>('local_list_reading_activity') : []
}

export async function saveReadingSnapshot(input: { url:string; excerpt:string; markdown:string }): Promise<void> {
  if (isTauri()) await invoke('local_save_reading_snapshot', input)
}

export async function clearBrowserHistory(since?: number): Promise<number> {
  if (!isTauri()) {
    const entries = await listBrowserHistory()
    const remaining = since === undefined ? [] : entries.filter(entry => entry.visitedAt < since)
    localStorage.setItem('browser.history', JSON.stringify(remaining))
    return entries.length - remaining.length
  }
  return invoke<number>('local_clear_history', { since: since ?? null })
}

export async function getBrowserWorkspace(): Promise<{ tabs: BrowserTab[]; activeTabId: string } | null> {
  if (!isTauri()) return null
  return invoke('local_get_browser_workspace')
}

export async function saveBrowserWorkspace(workspace: { tabs: BrowserTab[]; activeTabId: string }): Promise<void> {
  if (isTauri()) await invoke('local_save_browser_workspace', { workspace })
}

export async function listClosedTabs(): Promise<ClosedTab[]> {
  return isTauri() ? invoke('local_list_closed_tabs') : []
}

export async function saveClosedTab(tab: ClosedTab): Promise<void> {
  if (isTauri()) await invoke('local_save_closed_tab', { tab })
}

export async function deleteClosedTab(id: string): Promise<void> {
  if (isTauri()) await invoke('local_delete_closed_tab', { id })
}

export async function clearClosedTabs(): Promise<void> {
  if (isTauri()) await invoke('local_clear_closed_tabs')
}

export async function listSitePermissions(): Promise<SitePermissionRule[]> {
  if (!isTauri()) return []
  const rows = await invoke<{ origin: string; permissionKind: keyof Omit<SitePermissionRule, 'origin'>; decision: 'allow' | 'deny' | 'ask' }[]>('local_list_site_permissions')
  const grouped = new Map<string, SitePermissionRule>()
  for (const row of rows) {
    const rule = grouped.get(row.origin) ?? { origin: row.origin, camera: 'ask', microphone: 'ask', location: 'ask', notifications: 'ask', clipboard: 'ask' }
    rule[row.permissionKind] = row.decision
    grouped.set(row.origin, rule)
  }
  return [...grouped.values()]
}

export async function replaceSitePermissions(rules: SitePermissionRule[]): Promise<void> {
  if (!isTauri()) return
  const permissions = rules.flatMap(rule => (['camera', 'microphone', 'location', 'notifications', 'clipboard'] as const).map(permissionKind => ({ origin: rule.origin, permissionKind, decision: rule[permissionKind] })))
  await invoke('local_replace_site_permissions', { permissions })
}

export const BROWSER_SHORTCUTS_STORAGE_KEY = 'arcadia-browser-shortcuts-enabled'

export function getBrowserShortcutsEnabled(): boolean {
  try {
    const raw = localStorage.getItem(BROWSER_SHORTCUTS_STORAGE_KEY)
    if (raw === null) return true
    const parsed = JSON.parse(raw) as { enabled?: boolean }
    return parsed.enabled !== false
  } catch {
    return true
  }
}

export function setBrowserShortcutsEnabled(enabled: boolean): void {
  localStorage.setItem(BROWSER_SHORTCUTS_STORAGE_KEY, JSON.stringify({ enabled }))
  window.dispatchEvent(new CustomEvent('arcadia-shortcuts-change', { detail: { enabled } }))
}

export interface BackupDocument {
  id: string
  title: string
  url: string
  source?: string
  author?: string
  summary?: string
  markdown?: string
  wordCount: number
  status: string
  tags: string[]
  createdAt: string
  starred: boolean
}
export interface BackupSessionEntry { key: string; value: string }
export interface Backup {
  version: number
  exportedAt: string
  documents: BackupDocument[]
  session: BackupSessionEntry[]
}
export interface ImportSummary {
  documentsInserted: number
  documentsSkipped: number
  sessionInserted: number
}

export async function exportBackup(): Promise<Backup> {
  if (!isTauri()) return { version: 1, exportedAt: '', documents: [], session: [] }
  return invoke<Backup>('local_export_backup')
}

export async function importBackup(backup: Backup): Promise<ImportSummary> {
  if (!isTauri()) return { documentsInserted: 0, documentsSkipped: 0, sessionInserted: 0 }
  return invoke<ImportSummary>('local_import_backup', { backup })
}

function createDocument(input: { title: string; url: string; markdown: string; tags: string[] }): Document {
  let source = ''
  try { source = new URL(input.url).hostname } catch { /* keep source empty */ }
  return { id: `local-${crypto.randomUUID()}`, ...input, source, wordCount: input.markdown.trim() ? input.markdown.trim().split(/\s+/u).length : 0, status: 'READY', autoTags: [], createdAt: new Date().toISOString(), starred: false }
}
