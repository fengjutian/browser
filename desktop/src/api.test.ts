import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { deleteDocument, getDocument, listDocuments, saveDocument, toggleStarred } from './api'

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
})