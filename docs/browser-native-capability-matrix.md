# Browser Native Capability Matrix

> Status: 第 11 轮迭代（10 批任务 + 3 follow-up），2026-09-23
> 对应版本：Tauri 2.x stable + wry (locked by `desktop/src-tauri/Cargo.toml`) + Microsoft Edge WebView2 Runtime

This document is the source of truth for what the embedded webview does and does
not expose to Rust and the React shell. The values mirrored in `browser_capabilities`
(Rust) and `services/browserCapabilities.ts` (frontend) must stay in lockstep
with the matrix below; tests in `src-tauri/src/lib.rs` (`capability_flags_match_matrix_expectations`)
assert that the Rust side matches.

## Versions Locked

- `tauri` 2.x stable, `features = ["unstable", "image-png"]`
- `wry` (re-exported through `tauri::webview`) — version pinned to whatever Tauri 2 ships with
- WebView2 Runtime (Windows): Microsoft Edge ≥ 109
- `reqwest` 0.12 with `rustls-tls` already in `Cargo.toml` for streaming downloads
- `webview2-com` 0.39 (Windows only, target `x86_64-pc-windows-msvc`) — see Known Limitations

## Delivered Batches

| Batch | Scope | Frontend state | Rust state | Docs |
| --- | --- | --- | --- | --- |
| 0 | Tab address suggestions + native capability probe + webview compat shell | `addressSuggestions`, `tabSyncReducer`, `useDownloads`, `useTabRuntime`, `services/browserCapabilities.ts` | `browser_capabilities`, `permission_guard_script`, `context_menu_script` | this file |
| 1A | Download SQLite + commands | `useDownloads`, `useDownloadCenter`, `<DownloadCenter>` | migration v8 `downloads` table + `downloads.rs` (5 commands) | — |
| 1B | reqwest streaming with byte progress + Range/416 fallback | `useDownloadCenter` pause/cancel/retry actions | `download_start_reqwest/pause/cancel/retry`, `.part` temp file, `unique_destination` | — |
| 2 | Right-click menu | `contextMenu.ts` (5 regions, 18 actions) + `ContextMenuView.tsx` | `context_menu_script` IIFE injection | — |
| 3 | Native site permissions | `sitePermissions.ts` (3-state), `usePermissionPrompt`, `<PermissionPromptBar>` | `browser_permission_request/respond`, `PermissionWaiters`, 15s timeout | — |
| 5 | Address bar upgrades | `navigation.ts` v2 (search template), `urlSafety.ts`, `suggestionProvider.ts`, `searchEngine.ts` | — | — |
| 6 | Privacy / private tabs | `privateTabs.ts`, `forceAllDenyFor`, `LockOutlined` UI | `forceAllDenyFor` reset on last private tab | — |
| 8 | Session + crash recovery | `sessionStore.ts` schema v2 + dual-slot rotation, `RecoveryPanel`, `useTabRuntime` reopen | `session_lock.rs`, migration v9 `session_locks` | — |
| 9 | WebView compat | `webviewCompat.ts` (pickFiles / shellOpen / toggleFullscreen), `<MoreOutlined/>` menu item | `webview_compat.rs` (shell_open blacklist, toggle_fullscreen, pick_files 300s timeout) | — |
| 10 | Performance / LRU | `lruPolicy.ts` (planLruSweep), `resourceStats.ts`, Settings 3 new toggles | — | — |
| 4 | Tab enhancements | `tabGrouping.ts`, tab menu (close-domain / mute), `crashed` field + UI | — | — |
| 7 | Download danger + log redaction + shell-open confirmation | `dangerClassifier.ts`, `logRedaction.ts`, `externalSchemes.ts` | — | — |
| 7+.cert | Certificate prompt UI | `useCertificatePrompt`, `<CertificateErrorBar>` | `certificate_guard.rs` (UI-only stub — see Known Limitations) | this file |

## Capability Matrix

| Capability | Supported | Source | Notes |
| --- | --- | --- | --- |
| Byte-level download progress | ✅ Direct | `tauri::webview::DownloadEvent::Progress { url, total, received, content_length }` | Forwarded as `browser://download` v2 events with `receivedBytes/totalBytes`. |
| Cancel in-flight download | ✅ Direct | Return `false` from `on_download` `Requested` handler | Wired in `lib.rs::browser_create`. Frontend `cancelDownload` command in batch 1. |
| Pause / resume download | ✅ Reqwest | `reqwest::Client` + `Range` header | Tauri 2 stable does NOT expose pause/resume on native downloads. WebView2 `IDownloadOperation` is reachable only via `webview2-com`, which we add for batch 7+.cert but do not use for this yet. |
| Native permission request events | ❌ Not supported | — | Tauri 2 stable does not surface `ICoreWebView2.PermissionRequested`. We inject a `permission_guard_script` that denies JS access and surface a JS-level prompt. **Frontend ↔ Rust roundtrip works**, but the host cannot intercept a real permission prompt fired by WebView2 itself. |
| Native context menu | ❌ Not supported | — | wry does not expose `ICoreWebView2ContextMenuRequested` in stable. We inject `context_menu_script` that emits `browser://context-menu` for the React overlay. |
| Clear site data (per-origin) | ❌ Not supported in stable | needs `webview2-com` | `ICoreWebView2Profile.ClearBrowsingData` + `ClearBrowsingDataInTimeRange` are reachable only via `webview2-com`. The dep is now in `Cargo.toml` but no method binding is wired up. Privacy cleanup falls back to localStorage / SQLite deletion. |
| Certificate error interceptor | ⚠️ Partial | `webview2-com` 0.39 + manual COM vtable | We added the dependency and a complete UI (banner + respond command), but `webview2-com` 0.39 only exposes `ServerCertificateErrorDetectedEventHandler` as a type — no `ICoreWebView2_5` cast helper. The Rust side is a no-op stub. **WebView2's default behaviour still blocks invalid certs**, so the user is never silently exposed; the banner only renders when something explicitly emits `browser://certificate-error`. |
| Audible detection (automatic) | ❌ Not supported | — | WebView2 does not expose audio playback events to JS in stable. `tab.audible` is a hint the user toggles via the right-click menu → "静音此标签页". Auto-detection would require `ICoreWebView2.WebView2Process` extended inspection or a media-element polling shim — not pursued. |
| Process-level WebView memory | ❌ Not supported in stable | needs `webview2-com` | `ICoreWebView2Process` (`WorkingSetSize`, `PrivateMemoryUsage`) requires `webview2-com` plus the same manual COM cast as certificates. The resource panel currently reports tab counts and LRU state, not process bytes. |
| WebView2 navigation error status | ⚠️ Partial | `wry::WebviewBuilder.on_page_load` | `NavigationCompleted` event with `WebErrorStatus` is reachable via `wry`'s `on_page_load` callback in newer versions. Currently not wired — relies on WebView2's automatic error page. Future: parse `WEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_*` and emit `browser://certificate-error`. |
| Webview backend label | ✅ Direct | `cfg(target_os)` | `"webview2"` on Windows, `"wkwebview"` on macOS, `"webkitgtk"` on Linux. |
| Tauri runtime version | ✅ Direct | `env!("CARGO_PKG_VERSION")` | Useful for diagnostics only; do not gate features on it. |

## Backend label matrix

| Target OS | Backend label | Notes |
| --- | --- | --- |
| `windows` | `webview2` | Requires Microsoft Edge WebView2 Runtime preinstalled. |
| `macos` | `wkwebview` | Uses the system WKWebView. |
| `linux` | `webkitgtk` | Requires `libwebkit2gtk-4.1-dev` (Tauri 2 standard). |
| Other | `unknown` | Compile succeeds; command still returns a payload so frontend never NPEs. |

## Known Limitations & Follow-ups

These are deliberate "supported in the matrix → but with the documented limitation above" gaps. Each line tells the next person what to chase when Tauri / WebView2 / `webview2-com` unblocks the path.

1. **Certificate interception (`certificate_guard.rs`)** — `attach_certificate_guard` is a no-op today. To upgrade:
   - Wait for `webview2-com` to ship `ICoreWebView2_5` (currently 0.39 only provides the callback type and declared IIDs).
   - Alternative: bind `ICoreWebView2_5` directly via `windows-rs` + raw COM cast (`QueryInterface`).
   - Wire a `Mutex<HashMap<requestId, oneshot::Sender<Allow>>>` so the deferral can be completed when `browser_certificate_respond` is invoked.
   - Subscribe to `wry::WebviewBuilder.on_page_load` for `WebErrorStatus::CertificateCommonNameInvalid` etc. and emit `browser://certificate-error` automatically.

2. **Audible detection** — Add a polling shim that runs `document.querySelectorAll('audio, video').forEach(e => ...)` in the active tab via `webview.eval()` and feeds counts back through `browser_state`. Cheap, JS-only, ~5% overhead. Useful when LRU wants to keep audible tabs alive (batch 10 already does this for manually-muted tabs).

3. **Process-level memory** — Same path as certificates: once `ICoreWebView2_5` (or `ICoreWebView2Process`) is bound, expose `WorkingSetSize` per label. Resource panel grows a fourth row "WebView 进程内存". Tauri may also add a `webview.process_id()` accessor in a future release.

4. **`NavigationCompleted` status** — When `wry::WebviewBuilder.on_page_load` exposes the status enum, classify the WebErrorStatus enum and forward `WebErrorStatus::Certificate*` into the certificate pipeline.

## Frontend contract

`BrowserCapabilities` (TS, `services/browserCapabilities.ts`):

```ts
interface BrowserCapabilities {
  downloadProgressBytes: boolean
  downloadPauseResume: boolean
  downloadCancel: boolean
  nativePermissionEvents: boolean
  nativeContextMenu: boolean
  clearSiteData: boolean
  certificateErrorInterceptor: boolean
  webviewBackend?: 'webview2' | 'wkwebview' | 'webkitgtk' | 'unknown'
  tauriRuntimeVersion?: string
}
```

`getBrowserCapabilities()` caches the resolved value and `peekBrowserCapabilities()`
returns the synchronous fallback when the call has not yet resolved. The
fallback is **all-false** except for `webviewBackend: 'unknown'`; this is
intentional so consumers default to "not available" rather than silent success.

## How to extend

When adding a capability:

1. Verify the underlying crate/API on the actual Tauri 2 stable docs. Cite the
   item in this table with the exact enum / method.
2. Implement the Rust detection (constants or `cfg`s are fine) in
   `src-tauri/src/lib.rs::browser_capabilities`.
3. Update the `capability_flags_match_matrix_expectations` test to assert the
   new value.
4. Update `services/browserCapabilities.ts` if a new field is added.
5. Never mark a feature "supported" when the platform-specific crate is
   missing from `Cargo.toml` — that's the failure mode the matrix exists to
   prevent.
6. If you implement a partial capability (like `certificateErrorInterceptor`),
   put the full upgrade path under "Known Limitations" so the next person can
   pick up without re-discovering the gap.