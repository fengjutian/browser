import { invoke } from '@tauri-apps/api/core'
import type { AIProvider, AIProviderType, ChatRequest, ChatResponse, Document, ProviderTestResult, Task } from './types'
import type { HistoryEntry } from './features/history/dedupeHistory'
import type { ClosedTab } from './features/browser/closedTabs'
import type { SitePermissionRule } from './features/browser/sitePermissions'
import { countTextUnits } from './shared/textCount'
import type { BrowserTab, ReadingActivity } from './types'

const isTauri = () => '__TAURI_INTERNALS__' in window

interface LocalSearchHit {
  document: Document
  titleSnippet: string
  markdownSnippet: string
  summarySnippet: string
  rank: number
}

export interface DocumentSearchHit extends Document {
  titleSnippet?: string
  markdownSnippet?: string
  summarySnippet?: string
  rank?: number
}

async function localSearch(query = ''): Promise<DocumentSearchHit[]> {
  if (!isTauri()) return []
  const hits = await invoke<LocalSearchHit[]>('local_list_documents', { query })
  return hits.map(({ document, titleSnippet, markdownSnippet, summarySnippet, rank }) => ({
    ...document,
    titleSnippet: titleSnippet || undefined,
    markdownSnippet: markdownSnippet || undefined,
    summarySnippet: summarySnippet || undefined,
    rank,
  }))
}

async function localSave(document: Document): Promise<Document> {
  return isTauri() ? invoke<Document>('local_save_document', { document }) : document
}

export async function listDocuments(query = ''): Promise<Document[]> {
  const hits = await localSearch(query)
  return hits.map(({ titleSnippet: _title, markdownSnippet: _markdown, summarySnippet: _summary, rank: _rank, ...document }) => document)
}

export async function searchDocuments(query: string): Promise<DocumentSearchHit[]> {
  return localSearch(query)
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

export interface EmbeddingMatch {
  documentId: string
  chunkIndex: number
  excerpt: string
  similarity: number
}

export async function storeDocumentEmbedding(
  documentId: string,
  chunkIndex: number,
  model: string,
  excerpt: string,
  vector: number[],
): Promise<void> {
  if (!isTauri()) return
  await invoke('local_store_embedding', { documentId, chunkIndex, model, excerpt, vector })
}

export async function clearDocumentEmbeddings(documentId: string): Promise<number> {
  if (!isTauri()) return 0
  return invoke<number>('local_clear_document_embeddings', { documentId })
}

export async function searchSimilarEmbeddings(
  model: string,
  vector: number[],
  topK = 8,
): Promise<EmbeddingMatch[]> {
  if (!isTauri()) return []
  return invoke<EmbeddingMatch[]>('local_search_similar', { model, vector, topK })
}

export async function aiChatStream(providerId: string, request: ChatRequest): Promise<string> {
  if (!isTauri()) throw new Error('Document unavailable')
  return invoke<string>('ai_chat_stream', { providerId, request })
}

export async function aiChatCancel(streamId: string): Promise<boolean> {
  if (!isTauri()) return false
  return invoke<boolean>('ai_chat_cancel', { streamId })
}

export async function aiTestProvider(providerId: string): Promise<ProviderTestResult> {
  if (!isTauri()) throw new Error('Document unavailable')
  return invoke<ProviderTestResult>('ai_test_provider', { providerId })
}

export type McpTransport = 'stdio' | 'http' | 'sse'
export interface McpServer {
  id: string
  name: string
  transport: McpTransport
  command?: string
  url?: string
  args: string[]
  env: Record<string, string>
  headers: Record<string, string>
  enabled: boolean
  createdAt: string
  updatedAt: string
}
export interface McpServerInput extends Omit<McpServer, 'id' | 'createdAt' | 'updatedAt'> { id?: string }

export async function saveMcpServer(server: McpServerInput): Promise<McpServer> {
  if (!isTauri()) throw new Error('MCP configuration requires the desktop app')
  return invoke<McpServer>('local_save_mcp_server', { server })
}

export async function listMcpServers(): Promise<McpServer[]> {
  if (!isTauri()) return []
  return invoke<McpServer[]>('local_list_mcp_servers')
}

export async function deleteMcpServer(id: string): Promise<boolean> {
  if (!isTauri()) return false
  return invoke<boolean>('local_delete_mcp_server', { id })
}

export async function discoverMcpServer(serverId: string): Promise<unknown> {
  if (!isTauri()) throw new Error('MCP requires the desktop app')
  return invoke('mcp_discover', { serverId })
}

export async function listMcpTools(serverId: string): Promise<unknown> {
  if (!isTauri()) throw new Error('MCP requires the desktop app')
  return invoke('mcp_list_tools', { serverId })
}

export async function listMcpResources(serverId: string): Promise<unknown> {
  if (!isTauri()) throw new Error('MCP requires the desktop app')
  return invoke('mcp_list_resources', { serverId })
}

export async function callMcpTool(serverId: string, name: string, args: Record<string, unknown>, approved: boolean): Promise<unknown> {
  if (!isTauri()) throw new Error('MCP requires the desktop app')
  return invoke('mcp_call_tool', { serverId, name, arguments: args, approved })
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

export interface ReadingSnapshotStats { count:number; bytes:number }
export async function getReadingSnapshotStats(): Promise<ReadingSnapshotStats> {
  return isTauri() ? invoke('local_reading_snapshot_stats') : { count:0, bytes:0 }
}
export async function deleteReadingSnapshot(url:string): Promise<void> {
  if (isTauri()) await invoke('local_delete_reading_snapshot', { url })
}
export async function clearReadingSnapshots(): Promise<ReadingSnapshotStats> {
  return isTauri() ? invoke('local_clear_reading_snapshots') : { count:0, bytes:0 }
}
export async function purgeReadingSnapshots(retentionDays:number, maxBytes:number): Promise<ReadingSnapshotStats> {
  return isTauri() ? invoke('local_purge_reading_snapshots', { retentionDays, maxBytes }) : { count:0, bytes:0 }
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
  return { id: `local-${crypto.randomUUID()}`, ...input, source, wordCount: countTextUnits(input.markdown), status: 'READY', autoTags: [], createdAt: new Date().toISOString(), starred: false }
}
