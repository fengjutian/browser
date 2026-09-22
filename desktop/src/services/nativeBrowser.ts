import { invoke } from '@tauri-apps/api/core'
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { Webview } from '@tauri-apps/api/webview'
import { readSitePermissions } from '../features/browser/sitePermissions'

export interface BrowserBounds { x: number; y: number; width: number; height: number }
export interface NativeBrowserState { url: string; title: string; favicon?: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }
export interface NativePageSnapshot { url: string; html: string }
interface NativeNewTabRequest { openerLabel: string; url: string }
export interface NativeDownloadUpdate { tabLabel: string; url: string; path?: string; status: 'downloading'|'completed'|'failed' }
const labels = new Map<string, string>()
const isTauri = () => '__TAURI_INTERNALS__' in window
const labelFor = (tabId: string) => `browser-${tabId.replace(/[^a-zA-Z0-9-]/g, '-')}`

export async function openNativeTab(tabId: string, url: string, bounds: BrowserBounds): Promise<boolean> {
  if (!isTauri()) return false
  const label = labelFor(tabId)
  let webview = await Webview.getByLabel(label)
  if (!webview) {
    await invoke('browser_create', { label, url, bounds, permissions: readSitePermissions() })
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
    await invoke('browser_create', { label, url, bounds, permissions: readSitePermissions() })
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
