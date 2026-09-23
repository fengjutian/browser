import { describe, expect, it } from 'vitest'
import {
  addNote,
  groupNotesByUrl,
  listNotes,
  readNotes,
  removeNote,
  updateNote,
  writeNotes,
  type NoteEntry,
} from './notes'

function note(partial: Partial<NoteEntry>): NoteEntry {
  return {
    id: partial.id ?? 'n-1',
    url: partial.url ?? 'https://x.com',
    title: partial.title ?? 'X',
    text: partial.text ?? 'snippet',
    comment: partial.comment ?? '',
    createdAt: partial.createdAt ?? 1,
  }
}

describe('listNotes', () => {
  it('returns empty list for null / invalid input', () => {
    expect(listNotes(null)).toEqual([])
    expect(listNotes('not json')).toEqual([])
    expect(listNotes(JSON.stringify({ not: 'array' }))).toEqual([])
  })

  it('drops entries with missing fields and sorts newest first', () => {
    const mixed = [
      note({ id: 'a', createdAt: 1 }),
      note({ id: 'b', createdAt: 5 }),
    ]
    mixed[1] = { ...mixed[1], createdAt: 'not-a-number' as unknown as number }
    const raw = JSON.stringify(mixed)
    const out = listNotes(raw)
    expect(out.length).toBe(1)
    expect(out[0].id).toBe('a')
  })

  it('sorts notes by createdAt descending', () => {
    const raw = JSON.stringify([note({ id: 'a', createdAt: 1 }), note({ id: 'b', createdAt: 5 }), note({ id: 'c', createdAt: 3 })])
    expect(listNotes(raw).map(n => n.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('addNote / removeNote / updateNote', () => {
  it('prepends a new note and caps the history at 500', () => {
    let notes: NoteEntry[] = []
    for (let i = 0; i < 502; i += 1) {
      notes = addNote(notes, { url: 'https://x', title: 'X', text: `s${i}`, comment: '' })
    }
    expect(notes.length).toBe(500)
    expect(notes[0].text).toBe('s501')
  })

  it('removes by id', () => {
    const notes = [note({ id: 'a' }), note({ id: 'b' })]
    expect(removeNote(notes, 'a').map(n => n.id)).toEqual(['b'])
  })

  it('updates comment / title / text', () => {
    const notes = [note({ id: 'a', text: 'old' })]
    const updated = updateNote(notes, 'a', { comment: 'hi' })
    expect(updated[0].comment).toBe('hi')
    expect(updated[0].text).toBe('old')
  })

  it('passes through an unknown id untouched', () => {
    const notes = [note({ id: 'a' })]
    expect(updateNote(notes, 'missing', { comment: 'hi' })).toEqual(notes)
  })
})

describe('groupNotesByUrl', () => {
  it('groups notes by URL and sorts groups by latest activity', () => {
    const notes = [
      note({ id: '1', url: 'https://a', createdAt: 5 }),
      note({ id: '2', url: 'https://b', createdAt: 9 }),
      note({ id: '3', url: 'https://a', createdAt: 6 }),
    ]
    const groups = groupNotesByUrl(notes)
    expect(groups.map(g => g.url)).toEqual(['https://b', 'https://a'])
    expect(groups[1].notes.map(n => n.id)).toEqual(['3', '1'])
  })
})

describe('readNotes / writeNotes', () => {
  it('round-trips through localStorage in happy-dom', () => {
    if (typeof localStorage === 'undefined') return
    writeNotes([note({ id: 'a' })])
    expect(readNotes()[0].id).toBe('a')
  })
})