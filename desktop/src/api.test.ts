import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import {
  deleteDocument,
  exportBackup,
  getBrowserShortcutsEnabled,
  getDocument,
  getSession,
  importBackup,
  listDocuments,
  saveDocument,
  setBrowserShortcutsEnabled,
  setSession,
  toggleStarred,
} from './api'

const setTauri = (present: boolean) => {
  if (present) {
    ;(window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {}
  } else {
    delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__
  }
}

const baseInput = {
  title: 'T',
  url: 'https://example.com/x',
  markdown: 'one two three',
  tags: ['Inbox'],
}

describe('api', () => {
  beforeEach(() => {
    invoke.mockReset()
    setTauri(false)
  })

  afterEach(() => setTauri(false))

  describe('non-Tauri (web dev) mode', () => {
    it('listDocuments returns [] and never calls invoke', async () => {
      const result = await listDocuments('foo')
      expect(result).toEqual([])
      expect(invoke).not.toHaveBeenCalled()
    })

    it('saveDocument returns the locally built document without invoke', async () => {
      const result = await saveDocument(baseInput)
      expect(invoke).not.toHaveBeenCalled()
      expect(result.id).toMatch(/^local-/)
      expect(result.status).toBe('READY')
      expect(result.title).toBe(baseInput.title)
      expect(result.source).toBe('example.com')
      expect(result.wordCount).toBe(3)
      expect(result.autoTags).toEqual([])
      expect(typeof result.createdAt).toBe('string')
    })

    it('getDocument throws "Document unavailable" without calling invoke', async () => {
      await expect(getDocument('local-xyz')).rejects.toThrow('Document unavailable')
      expect(invoke).not.toHaveBeenCalled()
    })

    it('deleteDocument is a no-op without calling invoke', async () => {
      await expect(deleteDocument('local-x')).resolves.toBeUndefined()
      expect(invoke).not.toHaveBeenCalled()
    })

    it('toggleStarred throws "Document unavailable" without calling invoke', async () => {
      await expect(toggleStarred('local-x', true)).rejects.toThrow('Document unavailable')
      expect(invoke).not.toHaveBeenCalled()
    })

    it('getSession returns null without calling invoke in non-Tauri mode', async () => {
      await expect(getSession('any.key')).resolves.toBeNull()
      expect(invoke).not.toHaveBeenCalled()
    })

    it('setSession is a no-op without calling invoke in non-Tauri mode', async () => {
      await expect(setSession('any.key', 'value')).resolves.toBeUndefined()
      expect(invoke).not.toHaveBeenCalled()
    })

    it('exportBackup returns an empty backup in non-Tauri mode without invoking', async () => {
      const result = await exportBackup()
      expect(result).toEqual({ version: 1, exportedAt: '', documents: [], session: [] })
      expect(invoke).not.toHaveBeenCalled()
    })

    it('importBackup returns zero summary in non-Tauri mode without invoking', async () => {
      const summary = await importBackup({ version: 1, exportedAt: '', documents: [], session: [] })
      expect(summary).toEqual({ documentsInserted: 0, documentsSkipped: 0, sessionInserted: 0 })
      expect(invoke).not.toHaveBeenCalled()
    })
  })

  describe('Tauri runtime mode', () => {
    beforeEach(() => setTauri(true))

    it('listDocuments forwards the query to invoke', async () => {
      invoke.mockResolvedValueOnce([])
      await listDocuments('hello')
      expect(invoke).toHaveBeenCalledWith('local_list_documents', { query: 'hello' })
    })

    it('saveDocument forwards the document to invoke and returns invoke response', async () => {
      const stored = { ...baseInput, id: 'local-saved', status: 'READY' as const }
      invoke.mockResolvedValueOnce(stored)
      const result = await saveDocument(baseInput)
      expect(invoke).toHaveBeenCalledWith(
        'local_save_document',
        expect.objectContaining({
          document: expect.objectContaining({
            id: expect.stringMatching(/^local-/),
            status: 'READY',
            title: baseInput.title,
            source: 'example.com',
            wordCount: 3,
            autoTags: [],
          }),
        }),
      )
      expect(result).toEqual(stored)
    })

    it('getDocument returns the document when invoke yields one', async () => {
      const doc = { id: 'local-y', title: 'Y', url: 'u', status: 'READY' }
      invoke.mockResolvedValueOnce(doc)
      await expect(getDocument('local-y')).resolves.toEqual(doc)
    })

    it('getDocument throws "Document unavailable" when invoke returns null', async () => {
      invoke.mockResolvedValueOnce(null)
      await expect(getDocument('missing')).rejects.toThrow('Document unavailable')
    })

    it('deleteDocument forwards the id to invoke', async () => {
      invoke.mockResolvedValueOnce(undefined)
      await deleteDocument('local-del')
      expect(invoke).toHaveBeenCalledWith('local_delete_document', { id: 'local-del' })
    })

    it('toggleStarred forwards id and flag to invoke', async () => {
      invoke.mockResolvedValueOnce(true)
      const result = await toggleStarred('local-fav', true)
      expect(invoke).toHaveBeenCalledWith('local_toggle_starred', { id: 'local-fav', starred: true })
      expect(result).toBe(true)
    })

    it('toggleStarred surfaces backend "document not found" error', async () => {
      invoke.mockRejectedValueOnce(new Error('document not found: local-missing'))
      await expect(toggleStarred('local-missing', false)).rejects.toThrow('document not found')
    })

    it('getSession forwards key and returns the stored value', async () => {
      invoke.mockResolvedValueOnce('{"tabs":[1,2,3]}')
      await expect(getSession('browser.tabs')).resolves.toBe('{"tabs":[1,2,3]}')
      expect(invoke).toHaveBeenCalledWith('local_get_session', { key: 'browser.tabs' })
    })

    it('getSession returns null when backend has no entry', async () => {
      invoke.mockResolvedValueOnce(null)
      await expect(getSession('missing.key')).resolves.toBeNull()
    })

    it('setSession forwards key and value to invoke', async () => {
      invoke.mockResolvedValueOnce(undefined)
      await setSession('browser.tabs', '{"tabs":[]}')
      expect(invoke).toHaveBeenCalledWith('local_set_session', { key: 'browser.tabs', value: '{"tabs":[]}' })
    })

    it('exportBackup forwards to invoke in Tauri mode', async () => {
      invoke.mockResolvedValueOnce({ version: 1, exportedAt: '1', documents: [], session: [] })
      await exportBackup()
      expect(invoke).toHaveBeenCalledWith('local_export_backup')
    })

    it('importBackup forwards backup payload and returns summary', async () => {
      invoke.mockResolvedValueOnce({ documentsInserted: 3, documentsSkipped: 1, sessionInserted: 2 })
      const summary = await importBackup({ version: 1, exportedAt: '', documents: [], session: [] })
      expect(invoke).toHaveBeenCalledWith('local_import_backup', {
        backup: { version: 1, exportedAt: '', documents: [], session: [] },
      })
      expect(summary).toEqual({ documentsInserted: 3, documentsSkipped: 1, sessionInserted: 2 })
    })
  })

  describe('createDocument payload shape', () => {
    beforeEach(() => setTauri(true))

    it('counts words on the trimmed markdown', async () => {
      invoke.mockResolvedValueOnce({})
      await saveDocument({ ...baseInput, markdown: '  alpha  beta gamma ' })
      expect(invoke).toHaveBeenCalledWith(
        'local_save_document',
        expect.objectContaining({
          document: expect.objectContaining({ wordCount: 3 }),
        }),
      )
    })

    it('wordCount is 0 when markdown is whitespace-only', async () => {
      invoke.mockResolvedValueOnce({})
      await saveDocument({ ...baseInput, markdown: '   ' })
      expect(invoke).toHaveBeenCalledWith(
        'local_save_document',
        expect.objectContaining({
          document: expect.objectContaining({ wordCount: 0 }),
        }),
      )
    })

    it('source is the URL hostname when parseable', async () => {
      invoke.mockResolvedValueOnce({})
      await saveDocument({ ...baseInput, url: 'https://docs.example.com/path?q=1' })
      expect(invoke).toHaveBeenCalledWith(
        'local_save_document',
        expect.objectContaining({
          document: expect.objectContaining({ source: 'docs.example.com' }),
        }),
      )
    })

    it('source is empty when URL cannot be parsed', async () => {
      invoke.mockResolvedValueOnce({})
      await saveDocument({ ...baseInput, url: 'not a url' })
      expect(invoke).toHaveBeenCalledWith(
        'local_save_document',
        expect.objectContaining({
          document: expect.objectContaining({ source: '' }),
        }),
      )
    })

    it('id starts with "local-" and status is "READY" on every save', async () => {
      invoke.mockResolvedValueOnce({})
      await saveDocument(baseInput)
      expect(invoke).toHaveBeenCalledWith(
        'local_save_document',
        expect.objectContaining({
          document: expect.objectContaining({
            id: expect.stringMatching(/^local-/),
            status: 'READY',
          }),
        }),
      )
    })
  })

  describe('browser shortcuts preference (localStorage)', () => {
    beforeEach(() => {
      localStorage.clear()
    })

    it('defaults to enabled when no value is stored', () => {
      expect(getBrowserShortcutsEnabled()).toBe(true)
    })

    it('returns false after persisting disabled', () => {
      setBrowserShortcutsEnabled(false)
      expect(getBrowserShortcutsEnabled()).toBe(false)
    })

    it('returns true after persisting enabled', () => {
      setBrowserShortcutsEnabled(false)
      setBrowserShortcutsEnabled(true)
      expect(getBrowserShortcutsEnabled()).toBe(true)
    })

    it('falls back to enabled when stored value is malformed', () => {
      localStorage.setItem('arcadia-browser-shortcuts-enabled', 'not json {')
      expect(getBrowserShortcutsEnabled()).toBe(true)
    })

    it('falls back to enabled when explicit false is missing', () => {
      localStorage.setItem('arcadia-browser-shortcuts-enabled', JSON.stringify({}))
      expect(getBrowserShortcutsEnabled()).toBe(true)
    })

    it('dispatches a change event when toggled', () => {
      const listener = vi.fn()
      window.addEventListener('arcadia-shortcuts-change', listener)
      setBrowserShortcutsEnabled(false)
      expect(listener).toHaveBeenCalled()
      const event = listener.mock.calls[0][0] as CustomEvent<{ enabled: boolean }>
      expect(event.detail.enabled).toBe(false)
      window.removeEventListener('arcadia-shortcuts-change', listener)
    })
  })
})
