import { invoke } from '@tauri-apps/api/core'
import type { AIProvider, AIProviderType, Document, Task } from './types'

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
  return invoke<AIProvider>('local_save_ai_provider', input)
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
  return { id: `local-${crypto.randomUUID()}`, ...input, source, wordCount: input.markdown.trim() ? input.markdown.trim().split(/\s+/u).length : 0, status: 'READY', createdAt: new Date().toISOString(), starred: false }
}
