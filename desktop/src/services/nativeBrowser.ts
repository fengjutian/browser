import { invoke } from '@tauri-apps/api/core'
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { Webview } from '@tauri-apps/api/webview'
import { readSitePermissions } from '../features/browser/sitePermissions'
import { isAdBlockerEnabled } from '../features/plugins/adBlocker'

export interface BrowserBounds { x: number; y: number; width: number; height: number }
export interface NativeBrowserState { url: string; title: string; favicon?: string; loading: boolean; scrollX: number; scrollY: number; canGoBack: boolean; canGoForward: boolean }
export interface NativePageSnapshot { url: string; html: string }
/**
 * v1: openerLabel + url. Future revisions may add origin, gesture, etc. The
 * `version` field is always present on Rust-emitted events; consumers should
 * treat missing fields as v1.
 */
interface NativeNewTabRequest { version: number; openerLabel: string; url: string }
/**
 * v2 download progress payload emitted on `browser://download`. Legacy v1
 * fields (`tabLabel`, `url`, `path`, `status`) are preserved; new fields
 * cover id-based dedupe, byte progress, danger classification, and private
 * mode. Missing `version` is treated as v1 (only legacy fields populated).
 */
export interface NativeDownloadUpdate {
  version: number
  kind: 'started' | 'progress' | 'finished' | 'failed' | 'cancelled' | 'blocked'
  id: string
  tabLabel: string
  url: string
  fileName?: string
  targetPath?: string
  mimeType?: string
  receivedBytes?: number
  totalBytes?: number
  progressKnown?: boolean
  status: 'downloading' | 'completed' | 'failed' | 'cancelled' | 'blocked' | 'paused' | 'queued'
  dangerType?: 'none' | 'executable' | 'script' | 'archive' | 'document' | 'other'
  errorMessage?: string
  private?: boolean
  sourceOrigin?: string
}
export const EVENT_PAYLOAD_VERSION = 2
const labels = new Map<string, string>()
const isTauri = () => '__TAURI_INTERNALS__' in window
export const isNativeBrowserAvailable = (): boolean => isTauri()
const labelFor = (tabId: string) => `browser-${tabId.replace(/[^a-zA-Z0-9-]/g, '-')}`

export async function openNativeTab(tabId: string, url: string, bounds: BrowserBounds): Promise<boolean> {
  if (!isTauri()) return false
  const label = labelFor(tabId)
  let webview = await Webview.getByLabel(label)
  if (!webview) {
    await invoke('browser_create', { label, url, bounds, permissions: readSitePermissions(), adBlockEnabled: isAdBlockerEnabled() })
    webview = await Webview.getByLabel(label)
    if (!webview) throw new Error('browser tab webview was not created')
  } else {
    await invoke<string>('browser_navigate', { label, url })
    await webview.show()
  }
  labels.set(tabId, label)
  await resizeNativeTab(tabId, bounds)
  return true
}

export async function ensureNativeTab(tabId: string, url: string, bounds: BrowserBounds): Promise<boolean> {
  if (!isTauri()) return false
  const label = labelFor(tabId)
  const existing = await Webview.getByLabel(label)
  if (existing) {
    await invoke<string>('browser_navigate', { label, url })
  } else {
    await invoke('browser_create', { label, url, bounds, permissions: readSitePermissions(), adBlockEnabled: isAdBlockerEnabled() })
    const created = await Webview.getByLabel(label)
    if (!created) throw new Error('browser tab webview was not created')
  }
  labels.set(tabId, label)
  await resizeNativeTab(tabId, bounds)
  return true
}

export async function showNativeTab(tabId: string): Promise<void> { const label=labels.get(tabId); if(label) await (await Webview.getByLabel(label))?.show() }
export async function hideNativeTab(tabId: string): Promise<void> { const label=labels.get(tabId); if(label) await (await Webview.getByLabel(label))?.hide() }
export async function closeNativeTab(tabId: string): Promise<void> { const label=labels.get(tabId); if(label) await (await Webview.getByLabel(label))?.close(); labels.delete(tabId) }
export async function resizeNativeTab(tabId: string, bounds: BrowserBounds): Promise<void> { const label=labels.get(tabId); if(!label)return;const view=await Webview.getByLabel(label);if(!view)return;await view.setPosition(new LogicalPosition(bounds.x,bounds.y));await view.setSize(new LogicalSize(Math.max(1,bounds.width),Math.max(1,bounds.height))) }
export async function reloadNativeTab(tabId: string): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_reload',{label}) }
export async function stopNativeTab(tabId: string): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_stop',{label}) }
export async function findInNativeTab(tabId: string, query: string, backwards = false): Promise<boolean> { const label=labels.get(tabId);return label ? invoke<boolean>('browser_find',{label,query,backwards}) : false }
export async function zoomNativeTab(tabId: string, scale: number): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_zoom',{label,scale}) }
export async function printNativeTab(tabId: string): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_print',{label}) }
export async function navigateHistory(tabId: string, delta: -1|1): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_history',{label,delta}) }
export async function readNativeState(tabId: string): Promise<NativeBrowserState | null> { const label=labels.get(tabId);return label ? invoke<NativeBrowserState>('browser_state',{label}) : null }
export async function restoreNativeScroll(tabId: string, x: number, y: number): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_restore_scroll',{label,x,y}) }
export async function isNativeTabAlive(tabId: string): Promise<boolean> { const label=labels.get(tabId) ?? labelFor(tabId);return !!(await Webview.getByLabel(label)) }
export async function setNativeAdBlocking(enabled: boolean): Promise<void> {
  await Promise.all(Array.from(labels.values(), label => invoke('browser_set_ad_blocking', { label, enabled })))
}
export async function captureNativePage(tabId: string): Promise<NativePageSnapshot> { const label=labels.get(tabId);if(!label)throw new Error('native webview is not available');return invoke<NativePageSnapshot>('browser_snapshot',{label}) }
export function hasNativeTab(tabId: string): boolean { return labels.has(tabId) }
export async function onNativeNewTab(handler: (url: string) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<NativeNewTabRequest>('browser://new-tab', event => handler(event.payload.url))
}
export async function onNativeDownload(handler: (download: NativeDownloadUpdate) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<NativeDownloadUpdate>('browser://download', event => handler(event.payload))
}

export interface AdBlockUpdate { version: number; tabLabel: string; blockedCount: number }
export async function onNativeAdBlockUpdate(handler: (update: AdBlockUpdate) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<AdBlockUpdate>('browser://ad-block-update', event => handler(event.payload))
}

/**
 * Right-click context menu payload emitted by the context-menu init script.
 * `clientX` / `clientY` are the cursor position in viewport coordinates of
 * the WebView itself — the host multiplies by the surface scale + offset
 * before showing the menu.
 */
export interface ContextMenuRequest {
  version: number
  kind: 'page' | 'selection' | 'link' | 'image' | 'input'
  clientX: number
  clientY: number
  selectionText: string
  linkUrl: string | null
  imageUrl: string | null
  editable: boolean
}

const CONTEXT_MENU_PAYLOAD_VERSION = 1

export async function onNativeContextMenu(handler: (request: ContextMenuRequest) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<ContextMenuRequest>('browser://context-menu', event => handler(event.payload))
}

/**
 * Best-effort check for "safe" protocols before opening a link from a
 * context menu. The Rust navigation layer also enforces the same rules,
 * but rejecting here keeps the menu item disabled when applicable.
 */
export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Permission request payload emitted by the JS-level guard script (see
 * `permission_guard_script` in `src-tauri/src/lib.rs`). The host shows an
 * inline prompt and replies via `respond_permission_request`.
 */
export interface PermissionRequest {
  version: number
  requestId: string
  origin: string
  kind: 'camera' | 'microphone' | 'location' | 'notifications' | 'clipboard' | 'media'
}

export async function onPermissionRequest(handler: (request: PermissionRequest) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<PermissionRequest>('browser://permission-request', event => handler(event.payload))
}

/**
 * Certificate error payload emitted by the Rust certificate guard. The
 * payload intentionally matches the Rust `CertificateErrorPayload` struct so
 * consumers can rely on stable field names.
 */
export interface CertificateErrorPayload {
  requestId: string
  url: string
  message: string
  repeated: boolean
}

const CERTIFICATE_ERROR_EVENT = 'browser://certificate-error'
const CERTIFICATE_ERROR_CLEARED_EVENT = 'browser://certificate-error-cleared'

export async function onCertificateError(handler: (payload: CertificateErrorPayload) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<CertificateErrorPayload>(CERTIFICATE_ERROR_EVENT, event => handler(event.payload))
}

export async function onCertificateErrorCleared(handler: (requestId: string) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined
  return listen<string>(CERTIFICATE_ERROR_CLEARED_EVENT, event => handler(event.payload))
}

export async function respondCertificateRequest(requestId: string, allow: boolean): Promise<void> {
  if (!isTauri()) return
  await invoke('browser_certificate_respond', { requestId, allow })
}

/**
 * Forward of `browser_capabilities` from the Rust side. Re-exposed so consumers
 * can stay on the `services/nativeBrowser.ts` import surface.
 */
export { getBrowserCapabilities, peekBrowserCapabilities, BROWSER_CAPABILITIES_FALLBACK, type BrowserCapabilities } from './browserCapabilities'
