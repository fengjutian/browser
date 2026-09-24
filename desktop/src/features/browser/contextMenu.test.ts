import { describe, expect, it } from 'vitest'
import { buildContextMenu, type ContextMenuCapabilities } from './contextMenu'
import type { ContextMenuRequest } from '../../services/nativeBrowser'

const caps: ContextMenuCapabilities = {
  canGoBack: true,
  canGoForward: false,
  canPrint: true,
  canAskAi: false,
}

const baseRequest: ContextMenuRequest = {
  version: 1,
  kind: 'page',
  clientX: 100,
  clientY: 200,
  selectionText: '',
  linkUrl: null,
  imageUrl: null,
  editable: false,
}

describe('buildContextMenu', () => {
  it('page region exposes back/forward/reload/stop + print + page info', () => {
    const { sections } = buildContextMenu({ ...baseRequest, kind: 'page' }, caps)
    const actions = sections.flatMap(s => s.items).map(i => i.action)
    expect(actions).toEqual(['back', 'forward', 'reload', 'stop', 'print', 'view-source'])
    const back = sections[0].items.find(i => i.action === 'back')!
    expect(back.enabled).toBe(true)
    const forward = sections[0].items.find(i => i.action === 'forward')!
    expect(forward.enabled).toBe(false)
  })

  it('selection region exposes notes, AI question, and translation actions', () => {
    const { sections } = buildContextMenu({ ...baseRequest, kind: 'selection', selectionText: 'hello world' }, caps)
    const items = sections.flatMap(s => s.items)
    expect(items.map(i => i.action)).toEqual(['copy', 'search-selection', 'add-to-notes', 'ask-ai', 'translate-selection'])
    const ai = items.find(i => i.action === 'ask-ai')!
    expect(ai.enabled).toBe(false)
    expect(ai.disabledReason).toBeTruthy()
    expect(items.find(i => i.action === 'translate-selection')?.enabled).toBe(false)
    const add = items.find(i => i.action === 'add-to-notes')!
    expect(add.enabled).toBe(true)
  })

  it('selection region disables add-to-notes when nothing is selected', () => {
    const { sections } = buildContextMenu({ ...baseRequest, kind: 'selection', selectionText: '' }, caps)
    const items = sections.flatMap(s => s.items)
    const add = items.find(i => i.action === 'add-to-notes')!
    expect(add.enabled).toBe(false)
  })

  it('link region disables open actions for javascript: and file: links', () => {
    const { sections } = buildContextMenu({ ...baseRequest, kind: 'link', linkUrl: 'javascript:alert(1)' }, caps)
    const items = sections.flatMap(s => s.items)
    const open = items.find(i => i.action === 'open-link-current')!
    expect(open.enabled).toBe(false)
    expect(open.disabledReason).toMatch(/协议/)
  })

  it('link region enables open + copy-link for https', () => {
    const { sections } = buildContextMenu({ ...baseRequest, kind: 'link', linkUrl: 'https://example.com/x' }, caps)
    const items = sections.flatMap(s => s.items)
    expect(items.find(i => i.action === 'open-link-current')!.enabled).toBe(true)
    expect(items.find(i => i.action === 'open-link-new')!.enabled).toBe(true)
    expect(items.find(i => i.action === 'copy-link')!.enabled).toBe(true)
    expect(items.find(i => i.action === 'open-link-external')!.enabled).toBe(false)
  })

  it('link region exposes shell-open for vscode:// and disables it for javascript:', () => {
    const vscode = buildContextMenu({ ...baseRequest, kind: 'link', linkUrl: 'vscode://file/path' }, caps)
    const external = vscode.sections.flatMap(s => s.items).find(i => i.action === 'open-link-external')!
    expect(external.enabled).toBe(true)

    const js = buildContextMenu({ ...baseRequest, kind: 'link', linkUrl: 'javascript:alert(1)' }, caps)
    const externalJs = js.sections.flatMap(s => s.items).find(i => i.action === 'open-link-external')!
    expect(externalJs.enabled).toBe(false)
  })

  it('image region uses open/copy/save and rejects file: src', () => {
    const { sections } = buildContextMenu({ ...baseRequest, kind: 'image', imageUrl: 'file:///C:/secret.png' }, caps)
    const items = sections.flatMap(s => s.items)
    expect(items.find(i => i.action === 'open-image-new')!.enabled).toBe(false)
    expect(items.find(i => i.action === 'save-image')!.enabled).toBe(false)
    expect(items.find(i => i.action === 'copy-image')!.enabled).toBe(true)
  })

  it('input region is purely edit commands', () => {
    const { sections } = buildContextMenu({ ...baseRequest, kind: 'input', editable: true }, caps)
    const actions = sections.flatMap(s => s.items).map(i => i.action)
    expect(actions).toEqual(['cut', 'copy', 'paste', 'select-all'])
  })

  it('preserves the original request for the caller', () => {
    const req = { ...baseRequest, kind: 'page' as const }
    const { request } = buildContextMenu(req, caps)
    expect(request).toBe(req)
  })
})
