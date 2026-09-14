import type { Document } from '../types'

const DATABASE = 'arcadia-local'
const STORE = 'documents'

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function listLocalDocuments(query = ''): Promise<Document[]> {
  const db = await database()
  const items = await requestResult(db.transaction(STORE).objectStore(STORE).getAll()) as Document[]
  db.close()
  const normalized = query.trim().toLocaleLowerCase()
  return items
    .filter(item => !normalized || `${item.title} ${item.summary ?? ''} ${item.markdown ?? ''} ${item.tags.join(' ')}`.toLocaleLowerCase().includes(normalized))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
}

export async function getLocalDocument(id: string): Promise<Document | undefined> {
  const db = await database()
  const item = await requestResult(db.transaction(STORE).objectStore(STORE).get(id)) as Document | undefined
  db.close()
  return item
}

export async function putLocalDocument(document: Document): Promise<void> {
  const db = await database()
  await requestResult(db.transaction(STORE, 'readwrite').objectStore(STORE).put(document))
  db.close()
}

export async function deleteLocalDocument(id: string): Promise<void> {
  const db = await database()
  await requestResult(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id))
  db.close()
}

export function createLocalDocument(input: { title: string; url: string; markdown: string; tags: string[] }): Document {
  const now = new Date().toISOString()
  let source = ''
  try { source = new URL(input.url).hostname } catch { /* retain an empty source */ }
  return {
    id: `local-${crypto.randomUUID()}`,
    title: input.title,
    url: input.url,
    source,
    markdown: input.markdown,
    wordCount: input.markdown.trim() ? input.markdown.trim().split(/\s+/u).length : 0,
    status: 'READY',
    tags: input.tags,
    createdAt: now,
  }
}
