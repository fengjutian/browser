import { invoke } from '@tauri-apps/api/core'

/**
 * Respond to a pending permission request. The Rust side looks up the
 * requestId in `PermissionWaiters` and resolves the in-flight
 * `browser_permission_request` Promise so the WebView's guard script can
 * resolve/reject the original JS call.
 */
export async function respondPermissionRequest(requestId: string, allow: boolean): Promise<boolean> {
  if (!('__TAURI_INTERNALS__' in window)) return false
  return invoke<boolean>('browser_permission_respond', { requestId, allow })
}