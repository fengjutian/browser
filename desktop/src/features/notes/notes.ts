/**
 * Highlight-to-note side panel. Captures text selections from the active
 * page and stores them in `localStorage` so they survive restarts. The actual
 * extraction is driven by the React context-menu action — this module is the
 * pure storage layer.
 */

export interface NoteEntry {
  id: string
  url: string
  title: string
  text: string
  comment: string
  createdAt: number
}

const STORAGE_KEY = 'arcadia.notes.v1'

export function listNotes(raw: string | null | undefined): NoteEntry[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is NoteEntry =>
      !!entry && typeof entry === 'object'
      && typeof (entry as NoteEntry).id === 'string'
      && typeof (entry as NoteEntry).url === 'string'
      && typeof (entry as NoteEntry).title === 'string'
      && typeof (entry as NoteEntry).text === 'string'
      && typeof (entry as NoteEntry).createdAt === 'number',
    ).sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

export function readNotes(): NoteEntry[] {
  if (typeof localStorage === 'undefined') return []
  return listNotes(localStorage.getItem(STORAGE_KEY))
}

export function writeNotes(notes: NoteEntry[]): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)) } catch { /* storage full */ }
}

export function addNote(notes: NoteEntry[], entry: Omit<NoteEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): NoteEntry[] {
  const merged: NoteEntry = {
    id: entry.id ?? crypto.randomUUID(),
    url: entry.url,
    title: entry.title,
    text: entry.text,
    comment: entry.comment,
    createdAt: entry.createdAt ?? Date.now(),
  }
  return [merged, ...notes].slice(0, 500)
}

export function removeNote(notes: NoteEntry[], id: string): NoteEntry[] {
  return notes.filter(note => note.id !== id)
}

export function updateNote(notes: NoteEntry[], id: string, patch: Partial<Pick<NoteEntry, 'comment' | 'text' | 'title'>>): NoteEntry[] {
  return notes.map(note => note.id === id ? { ...note, ...patch } : note)
}

/** Group notes by URL so the UI can show a section per page. */
export function groupNotesByUrl(notes: NoteEntry[]): Array<{ url: string; title: string; notes: NoteEntry[] }> {
  const groups = new Map<string, { url: string; title: string; notes: NoteEntry[] }>()
  for (const note of notes) {
    const existing = groups.get(note.url)
    if (existing) existing.notes.push(note)
    else groups.set(note.url, { url: note.url, title: note.title, notes: [note] })
  }
  for (const group of groups.values()) group.notes.sort((a, b) => b.createdAt - a.createdAt)
  return Array.from(groups.values()).sort((a, b) => {
    const aMax = Math.max(...a.notes.map(n => n.createdAt))
    const bMax = Math.max(...b.notes.map(n => n.createdAt))
    return bMax - aMax
  })
}