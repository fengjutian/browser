# Browser Native Capability Matrix

> Status: 第 0 批交付，2026-09-22
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

## Capability Matrix

| Capability | Supported | Source | Notes |
| --- | --- | --- | --- |
| Byte-level download progress | ✅ Direct | `tauri::webview::DownloadEvent::Progress { url, total, received, content_length }` | Currently the `_ => return true` arm in `lib.rs` swallows `Progress`. Batch 1 will forward it. |
| Cancel in-flight download | ✅ Direct | Return `false` from `on_download` `Requested` handler | Already wired in `lib.rs::browser_create`. The frontend command lands in batch 1. |
| Pause / resume download | ✅ Reqwest | `reqwest::Client` + `Range` header | Tauri 2 stable does NOT expose pause/resume. The native WebView2 `IDownloadOperation` is reachable only via `webview2-com`, which is **not** in `Cargo.toml`. Batch 1 will use the reqwest streaming fallback. |
| Native permission request events | ❌ Not supported | — | Tauri 2 stable does not surface `ICoreWebView2.PermissionRequested`. The current app only injects a `permission_guard_script` that denies JS access. Batch 3 will keep the strict installer approach (cover-in-decode) and not pretend to have native permission events. |
| Native context menu | ❌ Not supported | — | wry does not expose `ICoreWebView2ContextMenuRequested` in stable. Batch 2 will use an HTML overlay menu. |
| Clear site data (per-origin) | ❌ Not supported in stable | needs `webview2-com` | `ICoreWebView2Profile.ClearBrowsingData` + `ClearBrowsingDataInTimeRange` are reachable only via `webview2-com` / `webview2` crates, neither in `Cargo.toml`. Batch 6 will add the dep and the command; until then, feature is OFF. |
| Certificate error interceptor | ❌ Not supported in stable | needs `ICoreWebView2_5` | `ServerCertificateErrorDetected` requires `webview2-com` (`ICoreWebView2_5`). Batch 7 will add the dep and the user-once-in-session exception flow. |
| Webview backend label | ✅ Direct | `cfg(target_os)` | `"webview2"` on Windows, `"wkwebview"` on macOS, `"webkitgtk"` on Linux. |
| Tauri runtime version | ✅ Direct | `env!("CARGO_PKG_VERSION")` | Useful for diagnostics only; do not gate features on it. |

## Backend label matrix

| Target OS | Backend label | Notes |
| --- | --- | --- |
| `windows` | `webview2` | Requires Microsoft Edge WebView2 Runtime preinstalled. |
| `macos` | `wkwebview` | Uses the system WKWebView. |
| `linux` | `webkitgtk` | Requires `libwebkit2gtk-4.1-dev` (Tauri 2 standard). |
| Other | `unknown` | Compile succeeds; command still returns a payload so frontend never NPEs. |

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