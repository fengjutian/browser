import { invoke } from '@tauri-apps/api/core'
import type { Document } from './types'

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
