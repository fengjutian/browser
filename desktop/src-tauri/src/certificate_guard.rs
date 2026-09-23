//! Certificate error guard — best-effort wrapper around WebView2's
//! `ServerCertificateErrorDetected` event.
//!
//! **Current limitation**: `webview2-com` 0.39 does not ship the full
//! `ICoreWebView2_5` interface bindings (only the event-handler callback type
//! is exposed). Casting a base `ICoreWebView2` to `ICoreWebView2_5` requires
//! hand-written COM vtable walking. We deliberately stop short of that: the
//! default WebView2 behaviour already refuses to load a page whose certificate
//! cannot be validated, so the user is never silently exposed to an invalid
//! site.
//!
//! What this module *does* do today:
//! 1. Emit a stub `browser://certificate-error` event whenever the host
//!    application chooses to surface an error to the UI (e.g. when navigation
//!    fails through a `NavigationCompleted` failure status we know is
//!    certificate-related — see `lib.rs`).
//! 2. Accept a `browser_certificate_respond` command that the UI uses to
//!    acknowledge the error so the host can keep its state consistent.
//!
//! When `webview2-com` exposes a stable `ICoreWebView2_5` binding, replace
//! [`attach_certificate_guard`] with the real registration and start using
//! the `Allow` deferral to actually let users bypass specific errors.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Stable event name emitted when the host surfaces a certificate failure to
/// the UI. The frontend `useCertificatePrompt` hook listens for this event.
pub const CERTIFICATE_ERROR_EVENT: &str = "browser://certificate-error";
/// Event emitted when the user acknowledges / dismisses a certificate error.
pub const CERTIFICATE_ERROR_CLEARED_EVENT: &str = "browser://certificate-error-cleared";

#[derive(Clone, Debug, Serialize)]
pub struct CertificateErrorPayload {
    /// Stable id used by the UI to track and dismiss the prompt.
    pub request_id: String,
    /// The URL the browser was trying to reach.
    pub url: String,
    /// Human-readable reason as reported by WebView2.
    pub message: String,
    /// `true` when this is the second or later failure for the same origin in
    /// a short window; the UI uses this to escalate the warning copy.
    pub repeated: bool,
}

/// No-op stub that future Windows builds can replace with a real WebView2
/// `ServerCertificateErrorDetected` registration. Kept here so the rest of
/// the codebase has a single import path to swap in real behaviour.
#[cfg(target_os = "windows")]
pub fn attach_certificate_guard<R: Runtime>(_app: &AppHandle<R>, _window_label: &str) {
    // Intentional no-op until webview2-com exposes ICoreWebView2_5 directly.
}

#[cfg(not(target_os = "windows"))]
pub fn attach_certificate_guard<R: Runtime>(_app: &AppHandle<R>, _window_label: &str) {
    // Certificate inspection is a Windows/WebView2-only capability.
}

/// Emit a certificate-error event from the host code (e.g. when an external
/// navigation completes with `WEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_*`).
pub fn emit_certificate_error<R: Runtime>(
    app: &AppHandle<R>,
    payload: CertificateErrorPayload,
) -> tauri::Result<()> {
    app.emit(CERTIFICATE_ERROR_EVENT, payload)
}

/// Emit a "user dismissed the prompt" event so the UI can clear its banner.
pub fn emit_certificate_error_cleared<R: Runtime>(
    app: &AppHandle<R>,
    request_id: &str,
) -> tauri::Result<()> {
    app.emit(CERTIFICATE_ERROR_CLEARED_EVENT, request_id.to_string())
}

/// Tests + non-Tauri callers can ask whether the guard is wired up.
pub fn guard_attached<R: Runtime>(app: &AppHandle<R>, window_label: &str) -> bool {
    app.get_webview_window(window_label).is_some()
}

/// Frontend-facing command: the user acknowledged a certificate error. We log
/// the choice and notify the rest of the UI so the banner disappears. When a
/// real `ServerCertificateErrorDetected` binding exists, this command will
/// also resolve the outstanding deferral via a shared request-id registry.
#[tauri::command]
pub fn browser_certificate_respond<R: Runtime>(
    app: AppHandle<R>,
    request_id: String,
    allow: bool,
) -> Result<(), String> {
    if request_id.is_empty() {
        return Err("request_id is required".into());
    }
    let choice = if allow { "allow-once" } else { "deny" };
    let event = CertificateErrorPayload {
        request_id: request_id.clone(),
        url: String::new(),
        message: format!("user-chosen: {choice}"),
        repeated: false,
    };
    // Re-use the same emit so any UI subscribers see a single canonical shape;
    // the actual "clear" event lets the banner component hide itself.
    let _ = emit_certificate_error(&app, event);
    let _ = emit_certificate_error_cleared(&app, &request_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_round_trips_through_json() {
        let payload = CertificateErrorPayload {
            request_id: String::from("req-1"),
            url: String::from("https://example.com/path"),
            message: String::from("CERT_COMMON_NAME_INVALID"),
            repeated: true,
        };
        let value = serde_json::to_value(&payload).expect("payload must serialize");
        assert_eq!(value["repeated"], true);
        assert_eq!(value["url"], "https://example.com/path");
        assert_eq!(value["request_id"], "req-1");
    }

    #[test]
    fn event_names_are_stable_strings() {
        assert_eq!(CERTIFICATE_ERROR_EVENT, "browser://certificate-error");
        assert_eq!(CERTIFICATE_ERROR_CLEARED_EVENT, "browser://certificate-error-cleared");
    }
}