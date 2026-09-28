//! Capability matrix probe. The values returned here are the source of truth
//! mirrored by `services/browserCapabilities.ts` on the frontend; the
//! `capability_flags_match_matrix_expectations` test pins the contract.

use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCapabilities {
    /// True when granular byte-level download progress is observable.
    pub download_progress_bytes: bool,
    /// True when downloads can be paused/resumed through Tauri/WebView APIs.
    pub download_pause_resume: bool,
    /// True when in-flight downloads can be cancelled from the host.
    pub download_cancel: bool,
    /// True when a native permission-requested event is observable.
    pub native_permission_events: bool,
    /// True when a native context menu can be hooked to the webview.
    pub native_context_menu: bool,
    /// True when site data can be cleared through the host webview profile.
    pub clear_site_data: bool,
    /// True when TLS/certificate errors can be intercepted from code.
    pub certificate_error_interceptor: bool,
    /// Best-effort backend label for diagnostics ("webview2", "wkwebview", ...).
    pub webview_backend: Option<&'static str>,
    /// Tauri crate version compiled into the binary.
    pub tauri_runtime_version: Option<&'static str>,
}

#[tauri::command]
pub fn browser_capabilities() -> BrowserCapabilities {
    BrowserCapabilities {
        download_progress_bytes: true,
        download_pause_resume: false,
        download_cancel: true,
        native_permission_events: cfg!(target_os = "windows"),
        native_context_menu: false,
        clear_site_data: cfg!(target_os = "windows"),
        certificate_error_interceptor: cfg!(target_os = "windows"),
        webview_backend: Some(webview_backend_label()),
        tauri_runtime_version: Some(env!("CARGO_PKG_VERSION")),
    }
}

#[cfg(target_os = "windows")]
fn webview_backend_label() -> &'static str {
    "webview2"
}

#[cfg(target_os = "macos")]
fn webview_backend_label() -> &'static str {
    "wkwebview"
}

#[cfg(target_os = "linux")]
fn webview_backend_label() -> &'static str {
    "webkitgtk"
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn webview_backend_label() -> &'static str {
    "unknown"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_flags_match_matrix_expectations() {
        let caps = browser_capabilities();
        assert!(
            caps.download_progress_bytes,
            "download progress is always observable"
        );
        assert!(
            !caps.download_pause_resume,
            "Tauri 2 stable does not expose native pause/resume"
        );
        assert!(
            caps.download_cancel,
            "on_download Requested return-false is wired"
        );
        assert_eq!(caps.native_permission_events, cfg!(target_os = "windows"));
        assert!(
            !caps.native_context_menu,
            "wry has no context-menu integration in stable"
        );
        assert_eq!(caps.clear_site_data, cfg!(target_os = "windows"));
        assert_eq!(
            caps.certificate_error_interceptor,
            cfg!(target_os = "windows")
        );
        assert!(
            caps.webview_backend.is_some(),
            "backend label must be set on every target"
        );
        assert!(
            caps.tauri_runtime_version.is_some(),
            "tauri runtime version must be set"
        );
    }
}
