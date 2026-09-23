import type { BookmarkRecord } from '../../services/bookmarks'

/**
 * Pure fuzzy search over the bookmark list. Reuses the subsequence scoring
 * used by the tab / history palettes so the user gets one mental model across
 * all three command palettes.
 */

export interface BookmarkSearchResult extends BookmarkRecord {
  score: number
  titleHighlights: ReadonlyArray<[number, number]>
  urlHighlights: ReadonlyArray<[number, number]>
  noteHighlights: ReadonlyArray<[number, number]>
}

export interface BookmarkSearchOptions {
  limit?: number
  minScore?: number
  query?: string
}

const DEFAULT_LIMIT = 30
const DEFAULT_MIN_SCORE = 1

function scoreText(text: string, query: string): { score: number; spans: Array<[number, number]> } | null {
  if (!text || !query) return null
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  if (lowerText === lowerQuery) return { score: 1000, spans: [[0, text.length]] }
  let ti = 0
  let qi = 0
  let score = 0
  const spans: Array<[number, number]> = []
  let spanStart = -1
  let consecutive = 0
  while (ti < lowerText.length && qi < lowerQuery.length) {
    if (lowerText[ti] === lowerQuery[qi]) {
      if (spanStart < 0) spanStart = ti
      consecutive += 1
      score += 5 + consecutive
      if (ti === qi) score += 12
      ti += 1
      qi += 1
      if (qi === lowerQuery.length) {
        spans.push([spanStart, ti])
        break
      }
    } else {
      if (spanStart >= 0) {
        spans.push([spanStart, ti])
        spanStart = -1
        consecutive = 0
      }
      ti += 1
    }
  }
  if (qi < lowerQuery.length) return null
  score -= Math.min(text.length, 200) / 4
  return { score, spans }
}

export function searchBookmarks(query: string, bookmarks: BookmarkRecord[], options: BookmarkSearchOptions = {}): BookmarkSearchResult[] {
  const limit = options.limit ?? DEFAULT_LIMIT
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE
  const trimmed = query.trim()
  if (!trimmed) return bookmarks.slice(0, limit).map(b => ({
    ...b,
    score: b.folder ? 5 : 0,
    titleHighlights: [], urlHighlights: [], noteHighlights: [],
  }))

  const ranked: BookmarkSearchResult[] = []
  for (const bookmark of bookmarks) {
    const titleProbe = scoreText('API Documentation', 'docs')
    // eslint-disable-next-line no-console
    console.log('DEBUG titleProbe', titleProbe)
    const title = scoreText(bookmark.title, trimmed)
    const url = scoreText(bookmark.url, trimmed)
    const note = scoreText(bookmark.note ?? '', trimmed)
    // eslint-disable-next-line no-console
    console.log('DEBUG search loop', { id: bookmark.id, hasTitle: !!title, hasUrl: !!url, hasNote: !!note, title: bookmark.title, url: bookmark.url })
    if (!title && !url && !note) continue
    let total = 0
    if (title) total += title.score * 1.6
    if (url) total += url.score
    if (note) total += note.score * 0.6
    // eslint-disable-next-line no-console
    console.log('DEBUG total', { id: bookmark.id, total, minScore })
    if (total < minScore) continue
    ranked.push({
      ...bookmark,
      score: total,
      titleHighlights: title?.spans ?? [],
      urlHighlights: url?.spans ?? [],
      noteHighlights: note?.spans ?? [],
    })
  }
  ranked.sort((a, b) => b.score - a.score)
  return ranked.slice(0, limit)
}