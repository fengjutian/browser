import { invoke } from '@tauri-apps/api/core'

/**
 * Runtime capability flags for the embedded browser. Values are computed on
 * the Rust side (`browser_capabilities` in src-tauri/src/lib.rs) so that the
 * frontend never has to second-guess which Tauri/Wry/WebView2 features are
 * usable on the current host. The decision tree and source citations live in
 * `docs/browser-native-capability-matrix.md`.
 */
export interface BrowserCapabilities {
  /** True when the host browser exposes granular byte-level download progress. */
  downloadProgressBytes: boolean
  /** True when downloads can be paused/resumed via Tauri/WebView APIs. */
  downloadPauseResume: boolean
  /** True when in-flight downloads can be cancelled by the host. */
  downloadCancel: boolean
  /** True when a native permission-requested event is observable from Rust. */
  nativePermissionEvents: boolean
  /** True when a native context menu can be wired to the webview. */
  nativeContextMenu: boolean
  /** True when site data (cookies/cache/storage) can be cleared via the host. */
  clearSiteData: boolean
  /** True when TLS/certificate errors can be intercepted and answered from code. */
  certificateErrorInterceptor: boolean
  /** Backend `Tauri` runtime version, useful for diagnostics. */
  tauriRuntimeVersion?: string
  /** `webview2` on Windows, `wkwebview` on macOS, `webkitgtk` on Linux. */
  webviewBackend?: string
}

const isTauri = () => '__TAURI_INTERNALS__' in window

const FALLBACK: BrowserCapabilities = {
  downloadProgressBytes: false,
  downloadPauseResume: false,
  downloadCancel: false,
  nativePermissionEvents: false,
  nativeContextMenu: false,
  clearSiteData: false,
  certificateErrorInterceptor: false,
}

/**
 * Cached capability snapshot. Cached after first call so consumers can read it
 * synchronously without paying the invoke latency on every render.
 */
let cache: BrowserCapabilities | null = null
let inflight: Promise<BrowserCapabilities> | null = null

export async function getBrowserCapabilities(): Promise<BrowserCapabilities> {
  if (!isTauri()) return FALLBACK
  if (cache) return cache
  if (inflight) return inflight
  inflight = invoke<BrowserCapabilities>('browser_capabilities')
    .then(value => { cache = value; return value })
    .catch(() => { cache = FALLBACK; return FALLBACK })
    .finally(() => { inflight = null })
  return inflight
}

/**
 * Returns the cached capabilities if a previous call resolved, otherwise the
 * static fallback. Components should usually call `getBrowserCapabilities` at
 * mount and pass the result down, but this synchronously-safe getter avoids
 * blank "false" flashes on first render.
 */
export function peekBrowserCapabilities(): BrowserCapabilities {
  return cache ?? FALLBACK
}

export const BROWSER_CAPABILITIES_FALLBACK = FALLBACK