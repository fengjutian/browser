import { useCallback, useEffect, useState } from 'react'
import {
  addBookmark,
  listBookmarks,
  removeBookmark,
  updateBookmark,
  type BookmarkInput,
  type BookmarkRecord,
} from '../../services/bookmarks'

export interface BookmarkActions {
  bookmarks: BookmarkRecord[]
  refresh: () => Promise<void>
  add: (input: BookmarkInput) => Promise<BookmarkRecord>
  remove: (id: string) => Promise<void>
  update: (id: string, patch: Parameters<typeof updateBookmark>[1]) => Promise<BookmarkRecord>
}

/**
 * Thin wrapper around the Rust `bookmarks` commands. We re-fetch on every
 * mutation so the React state matches the database without a separate cache
 * layer. Bookmarks are small (typically < 200 rows), so the cost is negligible.
 */
export function useBookmarks(): BookmarkActions {
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([])

  const refresh = useCallback(async () => {
    try { setBookmarks(await listBookmarks()) } catch { /* leave the list untouched */ }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const add = useCallback(async (input: BookmarkInput) => {
    const result = await addBookmark(input)
    await refresh()
    return result
  }, [refresh])

  const remove = useCallback(async (id: string) => {
    await removeBookmark(id)
    setBookmarks(current => current.filter(b => b.id !== id))
  }, [])

  const update = useCallback(async (id: string, patch: Parameters<typeof updateBookmark>[1]) => {
    const result = await updateBookmark(id, patch)
    await refresh()
    return result
  }, [refresh])

  return { bookmarks, refresh, add, remove, update }
}