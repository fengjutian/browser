import { invoke } from '@tauri-apps/api/core'
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'
import { Webview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'

export interface BrowserBounds { x: number; y: number; width: number; height: number }
const labels = new Map<string, string>()
const isTauri = () => '__TAURI_INTERNALS__' in window
const labelFor = (tabId: string) => `browser-${tabId.replace(/[^a-zA-Z0-9-]/g, '-')}`

export async function openNativeTab(tabId: string, url: string, bounds: BrowserBounds): Promise<boolean> {
  if (!isTauri()) return false
  const label = labelFor(tabId)
  let webview = await Webview.getByLabel(label)
  if (!webview) {
    webview = new Webview(getCurrentWindow(), label, { url, ...bounds })
    await new Promise<void>((resolve, reject) => {
      void webview!.once('tauri://created', () => resolve())
      void webview!.once('tauri://error', event => reject(new Error(String(event.payload))))
    })
  } else {
    await invoke<string>('browser_navigate', { label, url })
    await webview.show()
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
export async function navigateHistory(tabId: string, delta: -1|1): Promise<void> { const label=labels.get(tabId);if(label)await invoke('browser_history',{label,delta}) }
export function hasNativeTab(tabId: string): boolean { return labels.has(tabId) }
