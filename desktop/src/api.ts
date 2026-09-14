import type { Document } from './types'
import { createLocalDocument, deleteLocalDocument, getLocalDocument, listLocalDocuments, putLocalDocument } from './services/localDocuments'

const BASE = 'http://127.0.0.1:8787/api/v1'

async function remoteDocuments(query = ''): Promise<Document[]> {
  const response = await fetch(`${BASE}/documents?q=${encodeURIComponent(query)}`)
  if (!response.ok) throw new Error('API unavailable')
  return (await response.json()).items
}

export async function listDocuments(query = ''): Promise<Document[]> {
  const local = await listLocalDocuments(query)
  try {
    const remote = await remoteDocuments(query)
    const merged = new Map(local.map(item => [item.id, item]))
    remote.forEach(item => merged.set(item.id, item))
    return [...merged.values()].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
  } catch {
    return local
  }
}

export async function saveDocument(input: { title: string; url: string; markdown: string; tags: string[] }): Promise<Document> {
  try {
    const response = await fetch(`${BASE}/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    if (!response.ok) throw new Error('Save failed')
    const document = await response.json() as Document
    await putLocalDocument(document)
    return document
  } catch {
    const document = createLocalDocument(input)
    await putLocalDocument(document)
    return document
  }
}

export async function getDocument(id: string): Promise<Document> {
  if (id.startsWith('local-')) {
    const local = await getLocalDocument(id)
    if (local) return local
  }
  try {
    const response = await fetch(`${BASE}/documents/${encodeURIComponent(id)}`)
    if (!response.ok) throw new Error('Document unavailable')
    const document = await response.json() as Document
    await putLocalDocument(document)
    return document
  } catch {
    const local = await getLocalDocument(id)
    if (!local) throw new Error('Document unavailable')
    return local
  }
}

export async function deleteDocument(id: string): Promise<void> {
  if (!id.startsWith('local-')) {
    try { await fetch(`${BASE}/documents/${encodeURIComponent(id)}`, { method: 'DELETE' }) } catch { /* local deletion still succeeds */ }
  }
  await deleteLocalDocument(id)
}
