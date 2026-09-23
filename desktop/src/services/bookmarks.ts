import { invoke } from '@tauri-apps/api/core'

export interface BookmarkRecord {
  id: string
  url: string
  title: string
  favicon?: string | null
  folder: string
  note: string
  position: number
  createdAt: string
  updatedAt: string
}

export interface BookmarkInput {
  id: string
  url: string
  title: string
  favicon?: string | null
  folder?: string | null
  note?: string | null
}

export interface BookmarkPatch {
  title?: string
  folder?: string
  note?: string
  position?: number
  favicon?: string | null
}

const isTauri = () => '__TAURI_INTERNALS__' in window

export async function listBookmarks(folder?: string): Promise<BookmarkRecord[]> {
  if (!isTauri()) return []
  return invoke<BookmarkRecord[]>('bookmark_list', { folder: folder ?? null })
}

export async function addBookmark(input: BookmarkInput): Promise<BookmarkRecord> {
  if (!isTauri()) throw new Error('addBookmark requires Taurius runtime')
  return invoke<BookmarkRecord>('bookmark_add', { input })
}

export async function getBookmark(id: string): Promise<BookmarkRecord | null> {
  if (!isTauri()) return null
  return invoke<BookmarkRecord | null>('bookmark_get', { id })
}

export async function removeBookmark(id: string): Promise<boolean> {
  if (!isTauri()) return false
  return invoke<boolean>('bookmark_remove', { id })
}

export async function updateBookmark(id: string, patch: BookmarkPatch): Promise<BookmarkRecord> {
  if (!isTauri()) throw new Error('updateBookmark requires Taurius runtime')
  return invoke<BookmarkRecord>('bookmark_update', { id, patch })
}

export async function moveBookmark(id: string, folder: string, position: number): Promise<void> {
  if (!isTauri()) return
  return invoke<void>('bookmark_move', { id, folder, position })
}