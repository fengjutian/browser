//! Platform-specific attachment (spec B5 / B6 / batch 7 + 11).
//!
//! Each platform owns its own `attach_subresource_filter` function. The
//! Windows version wires `WebResourceRequested` through `listener::decide`.
//! macOS exposes `WKContentRuleListStore` (still best-effort) and Linux can
//! try `WebKitGTK URI scheme` interception; both fall back to the legacy
//! top-level `NavigationStarting` hook and the JS cosmetic filter.
//!
//! All paths must:
//! - Register the event handler inside the same process that owns the
//!   WebView (COM lifetime requires this on Windows; `webview2_com` will
//!   drop the handler if its `Box<dyn>` lives in a different task).
//! - Detach cleanly when the WebView is closed — leaking handlers leaks
//!   the closure and slows subsequent navigations.
//! - Never block the request thread on a write-lock; the matcher is a
//!   snapshot read so it should be safe today, but the Windows path
//!   treats it as a hard invariant.

use std::sync::Arc;

use tauri::{AppHandle, Manager, Runtime};

use super::compiler::CompiledSetHandle;
use super::events::PrivacyEventSender;

/// Capability surface that the platform layer reports back. The UI calls
/// `privacy_capability_report` which forwards this through.
#[derive(Debug, Default, Clone)]
pub struct PlatformCapability {
    pub network_subresource_blocking: bool,
    pub cosmetic_filtering: bool,
    pub notes: Vec<String>,
}

pub const PLATFORM_PLACEHOLDER: &str = std::env::consts::OS;

/// Per-tab runtime state: the top-level origin (so we can compute
/// third-party accurately) and the privacy event sender used to record
/// blocks. The state is owned by the platform module's static
/// `TAB_STATE`; detach is a no-op when the label is unknown.
#[derive(Clone, Default)]
pub struct TabState {
    pub top_level_origin: String,
    pub top_level_url: String,
    pub private: bool,
}

fn tab_state_map() -> &'static std::sync::RwLock<std::collections::HashMap<String, TabState>> {
    static TAB_STATE: std::sync::OnceLock<
        std::sync::RwLock<std::collections::HashMap<String, TabState>>,
    > = std::sync::OnceLock::new();
    TAB_STATE.get_or_init(|| std::sync::RwLock::new(std::collections::HashMap::new()))
}

/// Set the current top-level origin for `label`. Called from the React side
/// on `NavigationStarting` / `NavigationCompleted` events.
pub fn set_tab_origin(label: &str, url: &str) {
    let origin = url_origin(url);
    let mut guard = match tab_state_map().write() {
        Ok(g) => g,
        Err(_) => return,
    };
    let entry = guard.entry(label.to_string()).or_default();
    entry.top_level_origin = origin;
    entry.top_level_url = url.to_string();
}

pub fn set_tab_private(label: &str, private: bool) {
    if let Ok(mut guard) = tab_state_map().write() {
        guard.entry(label.to_string()).or_default().private = private;
    }
}

pub fn remove_tab(label: &str) {
    if let Ok(mut guard) = tab_state_map().write() {
        guard.remove(label);
    }
}

pub fn tab_origin(label: &str) -> Option<TabState> {
    tab_state_map()
        .read()
        .ok()
        .and_then(|g| g.get(label).cloned())
}

/// Extract the scheme://host[:port] from a URL string. Falls back to the
/// empty string when the URL is not parseable.
pub fn url_origin(url: &str) -> String {
    let scheme_end = url.find("://").map(|i| i + 3).unwrap_or(0);
    let rest = &url[scheme_end..];
    let authority_end = rest
        .find(|c: char| c == '/' || c == '?' || c == '#')
        .unwrap_or(rest.len());
    url[..scheme_end + authority_end].to_string()
}

/// Return whether `request_host` is third-party relative to
/// `top_level_origin`. Uses registrable-domain matching when both are
/// hostnames and falls back to byte-level equality when either is an IP.
pub fn is_third_party(top_level_origin: &str, request_host: &str) -> bool {
    let top_host = host_of_origin(top_level_origin);
    let top_host = strip_port(&top_host);
    let req_host = strip_port(request_host.trim());
    if top_host.is_empty() || req_host.is_empty() {
        return false;
    }
    let top_reg = registrable_domain(&top_host);
    let req_reg = registrable_domain(&req_host);
    match (top_reg, req_reg) {
        (Some(a), Some(b)) => a != b,
        _ => top_host != req_host,
    }
}

fn strip_port(host: &str) -> String {
    // IPv6 literal: `[::1]` — strip the brackets and any ":port" suffix.
    if let Some(rest) = host.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            return rest[..end].to_string();
        }
    }
    if let Some(idx) = host.rfind(':') {
        return host[..idx].to_string();
    }
    host.to_string()
}

fn host_of_origin(origin: &str) -> String {
    let scheme_end = origin.find("://").map(|i| i + 3).unwrap_or(0);
    let rest = &origin[scheme_end..];
    // IPv6: bracketed literal `[::1]:port`. Don't split on the first `:`.
    if let Some(bracket_start) = rest.find('[') {
        if let Some(bracket_end_rel) = rest[bracket_start..].find(']') {
            let abs_end = bracket_start + bracket_end_rel;
            return rest[bracket_start..=abs_end].to_string();
        }
    }
    let host_end = rest
        .find(|c: char| c == ':' || c == '/' || c == '?' || c == '#')
        .unwrap_or(rest.len());
    rest[..host_end].to_string()
}

/// Compute a registrable domain using a small static suffix list. Good
/// enough for first-party checks against common trackers; private/local
/// hosts short-circuit to the host itself.
fn registrable_domain(host: &str) -> Option<String> {
    if host.is_empty() {
        return None;
    }
    if host.parse::<std::net::IpAddr>().is_ok() {
        return Some(host.to_ascii_lowercase());
    }
    if host.eq_ignore_ascii_case("localhost")
        || host.ends_with(".local")
        || host.ends_with(".localhost")
    {
        return Some(host.to_ascii_lowercase());
    }
    // Punycode: lower-case and keep the xn-- labels intact.
    let host = host.to_ascii_lowercase();
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() < 2 {
        return Some(host);
    }
    const PUBLIC_SUFFIXES: &[&str] = &[
        "co.uk", "co.jp", "co.kr", "co.nz", "co.za", "com.au", "com.br", "com.cn", "com.mx",
        "com.tr", "com.tw", "com.sg", "com.hk", "com.ar", "com.pl", "com.ru", "com.ua",
    ];
    let last_two = format!("{}.{}", parts[parts.len() - 2], parts[parts.len() - 1]);
    if PUBLIC_SUFFIXES.contains(&last_two.as_str()) && parts.len() >= 3 {
        Some(format!(
            "{}.{}.{}",
            parts[parts.len() - 3],
            parts[parts.len() - 2],
            parts[parts.len() - 1]
        ))
    } else {
        Some(format!(
            "{}.{}",
            parts[parts.len() - 2],
            parts[parts.len() - 1]
        ))
    }
}

/// Wire up the WebView2 subresource blocker. No-op on non-Windows targets.
pub fn attach_subresource_filter<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    set: Arc<CompiledSetHandle>,
    events: PrivacyEventSender,
    private: bool,
) -> PlatformCapability {
    set_tab_private(label, private);
    #[cfg(target_os = "windows")]
    {
        win::attach(app, label, set, events)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label, set, events);
        PlatformCapability {
            network_subresource_blocking: false,
            cosmetic_filtering: true,
            notes: vec![
                format!(
                    "{} has no batch-7 WebResourceRequested hook",
                    PLATFORM_PLACEHOLDER
                ),
                "Falling back to NavigationStarting + DOM cosmetic".into(),
            ],
        }
    }
}

/// Detach a previously-attached subresource filter for `label`. Safe to call
/// from any thread; returns true if a handler was actually revoked.
pub fn detach_subresource_filter<R: Runtime>(app: &AppHandle<R>, label: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        win::detach(app, label)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label);
        super::remove_tab(label);
        if let Some(caps) = app.try_state::<super::runtime::PrivacyRuntimeState>() {
            caps.capabilities.remove(label);
        }
        true
    }
}

/// Convenience wrapper that pulls the compiled set + event sender out of
/// the managed `PrivacyRuntimeState` and invokes `attach_subresource_filter`.
/// Records the resulting `CapabilityRecord` so the toolbar / settings page
/// can report the live capability per tab.
pub fn attach_from_runtime<R: Runtime>(app: &AppHandle<R>, label: &str, private: bool) -> PlatformCapability {
    let runtime = app
        .try_state::<super::runtime::PrivacyRuntimeState>();
    let runtime = match runtime {
        Some(s) => s,
        None => {
            return PlatformCapability {
                network_subresource_blocking: false,
                cosmetic_filtering: true,
                notes: vec!["PrivacyRuntimeState not managed".into()],
            };
        }
    };
    let cap = attach_subresource_filter(
        app,
        label,
        runtime.compiled.clone(),
        runtime.events.clone(),
        private,
    );
    runtime.capabilities.record(super::runtime::CapabilityRecord {
        label: label.to_string(),
        network_subresource_blocking: cap.network_subresource_blocking,
        cosmetic_filtering: cap.cosmetic_filtering,
        notes: cap.notes.clone(),
    });
    cap
}

#[cfg(target_os = "windows")]
mod win {
    use super::*;
    use crate::privacy::listener::{classify_resource_type, decide, DecideOutcome};
    use std::sync::Arc;
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment, ICoreWebView2WebResourceRequest,
        ICoreWebView2WebResourceRequestedEventArgs, ICoreWebView2_2, ICoreWebView2_22,
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
    };
    use windows::core::{Interface, PWSTR};

    pub fn attach<R: Runtime>(
        app: &AppHandle<R>,
        label: &str,
        set: Arc<CompiledSetHandle>,
        events: PrivacyEventSender,
    ) -> PlatformCapability {
        let cap = std::sync::Arc::new(std::sync::Mutex::new(PlatformCapability {
            network_subresource_blocking: false,
            cosmetic_filtering: true,
            notes: Vec::new(),
        }));
        let Some(view) = app.get_webview(label) else {
            cap.lock()
                .unwrap()
                .notes
                .push("no webview found for label".into());
            return cap.lock().unwrap().clone();
        };
        let label_owned = label.to_string();
        let set_for_closure = set.clone();
        let label_for_closure = label_owned.clone();
        let cap_for_closure = cap.clone();
        let events_for_closure = events.clone();
        let attach_result = view.with_webview(move |platform| {
            let core = match unsafe { platform.controller().CoreWebView2() } {
                Ok(c) => c,
                Err(_) => {
                    cap_for_closure
                        .lock()
                        .unwrap()
                        .notes
                        .push("CoreWebView2 unavailable".into());
                    return;
                }
            };
            let env = core
                .cast::<ICoreWebView2_2>()
                .ok()
                .and_then(|c2| unsafe { c2.Environment() }.ok());
            let filter_uri = windows::core::HSTRING::from("*");
            let filter_ok = if let Ok(core22) = core.cast::<ICoreWebView2_22>() {
                unsafe {
                    core22.AddWebResourceRequestedFilterWithRequestSourceKinds(
                        &filter_uri,
                        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                        webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                    )
                }
            } else if let Ok(core2) = core.cast::<ICoreWebView2_2>() {
                unsafe {
                    core2.AddWebResourceRequestedFilter(
                        &filter_uri,
                        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                    )
                }
            } else {
                Err(windows::core::Error::from_win32())
            };
            if filter_ok.is_err() {
                cap_for_closure
                    .lock()
                    .unwrap()
                    .notes
                    .push("AddWebResourceRequestedFilter failed".into());
                return;
            }
            let set_for_handler = set_for_closure.clone();
            let label_for_handler = label_for_closure.clone();
            let env_for_handler = env.clone().map(Arc::new);
            let events_for_handler = events_for_closure.clone();
            let label_for_token = label_for_closure.clone();
            let handler = webview2_com::WebResourceRequestedEventHandler::create(Box::new(
                move |_sender, args| {
                    dispatch(
                        &label_for_handler,
                        args.as_ref(),
                        &set_for_handler,
                        env_for_handler.as_deref(),
                        &events_for_handler,
                    )
                },
            ));
            let token_registered = if let Ok(core2) = core.cast::<ICoreWebView2_2>() {
                let mut token = 0;
                unsafe { core2.add_WebResourceRequested(&handler, &mut token).map(|()| token) }
            } else {
                Err(windows::core::Error::from_win32())
            };
            match token_registered {
                Ok(token) => {
                    // Token stored per-label so detach can revoke the handler.
                    store_registration_token(&label_for_token, token);
                }
                Err(_) => {
                    cap_for_closure
                        .lock()
                        .unwrap()
                        .notes
                        .push("add_WebResourceRequested failed".into());
                    return;
                }
            }
            let mut guard = cap_for_closure.lock().unwrap();
            guard.network_subresource_blocking = true;
            guard.notes.push("WebResourceRequested attached".into());
        });
        if attach_result.is_err() {
            cap.lock().unwrap().notes.push("with_webview failed".into());
        }
        match Arc::try_unwrap(cap) {
            Ok(mutex) => mutex.into_inner().unwrap_or_default(),
            Err(arc) => arc.lock().unwrap().clone(),
        }
    }

    fn store_registration_token(label: &str, token: i64) {
        if let Ok(mut map) = registration_tokens().lock() {
            map.insert(label.to_string(), token);
        }
    }

    fn registration_tokens() -> &'static std::sync::Mutex<std::collections::HashMap<String, i64>> {
        static REG: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, i64>>> =
            std::sync::OnceLock::new();
        REG.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
    }

    /// Revoke the WebResourceRequested handler for `label`. Returns true if a
    /// handler was actually removed, false if the label was unknown.
    pub fn detach<R: Runtime>(app: &AppHandle<R>, label: &str) -> bool {
        let token = match registration_tokens().lock() {
            Ok(mut map) => match map.remove(label) {
                Some(t) => t,
                None => return false,
            },
            Err(_) => return false,
        };
        let Some(view) = app.get_webview(label) else {
            return false;
        };
        let result = view.with_webview(move |platform| {
            if let Ok(core) = unsafe { platform.controller().CoreWebView2() } {
                if let Ok(core2) = core.cast::<ICoreWebView2_2>() {
                    let _ = unsafe { core2.remove_WebResourceRequested(token) };
                }
            }
        });
        if result.is_err() {
            return false;
        }
        super::remove_tab(label);
        if let Some(caps) = app.try_state::<super::super::runtime::PrivacyRuntimeState>() {
            caps.capabilities.remove(label);
        }
        true
    }

    pub fn dispatch(
        label: &str,
        args: Option<&ICoreWebView2WebResourceRequestedEventArgs>,
        set: &Arc<CompiledSetHandle>,
        env: Option<&ICoreWebView2Environment>,
        events: &PrivacyEventSender,
    ) -> windows::core::Result<()> {
        let Some(args) = args else { return Ok(()) };
        let request: ICoreWebView2WebResourceRequest = unsafe { args.Request()? };
        let mut uri_pwstr = PWSTR::null();
        unsafe { request.Uri(&mut uri_pwstr) }?;
        let url = unsafe { uri_pwstr.to_string() }.unwrap_or_default();
        let mut context: u32 = 0;
        let _ = unsafe { args.ResourceContext(&mut context as *mut _ as *mut _) };
        let resource_type = classify_resource_type(context);

        // Resolve the per-tab state so we can pass real origin / third_party.
        let tab = super::tab_origin(label);
        let top_level_origin = tab
            .as_ref()
            .map(|t| t.top_level_origin.clone())
            .unwrap_or_default();
        let private = tab.as_ref().map(|t| t.private).unwrap_or(false);
        let request_host = host_of_url(&url);
        let third_party = is_third_party(&top_level_origin, &request_host);

        let outcome = decide(
            &url,
            Some(&top_level_origin),
            resource_type,
            third_party,
            set,
        );

        // Record the decision in the channel (non-blocking).
        let blocked_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        match outcome {
            DecideOutcome::Blocked => {
                events.record_block();
                events.try_send(super::super::events::PrivacyBlockEvent {
                    tab_label: label.to_string(),
                    top_level_origin,
                    request_host,
                    resource_type,
                    rule_id: None,
                    category: None,
                    private,
                    blocked_at,
                });
                if let Some(env) = env {
                    let no_content = windows::core::HSTRING::from("No Content");
                    let headers = windows::core::HSTRING::from("Content-Length: 0\r\n");
                    let response =
                        unsafe { env.CreateWebResourceResponse(None, 204, &no_content, &headers)? };
                    unsafe { args.SetResponse(&response)? };
                }
            }
            DecideOutcome::Allowed | DecideOutcome::PassThrough => {
                events.record_allow();
            }
            DecideOutcome::Skipped => {}
        }
        Ok(())
    }

    fn host_of_url(url: &str) -> String {
        let scheme_end = url.find("://").map(|i| i + 3).unwrap_or(0);
        let rest = &url[scheme_end..];
        let host_end = rest
            .find(|c: char| c == ':' || c == '/' || c == '?' || c == '#')
            .unwrap_or(rest.len());
        rest[..host_end].to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_windows_attach_reports_no_network_capability() {
        let cap = PlatformCapability {
            network_subresource_blocking: false,
            cosmetic_filtering: true,
            notes: vec!["test".into()],
        };
        assert!(!cap.network_subresource_blocking);
        assert!(cap.cosmetic_filtering);
    }

    #[test]
    fn url_origin_strips_path_query() {
        assert_eq!(
            url_origin("https://example.com/foo?bar=1"),
            "https://example.com"
        );
        assert_eq!(
            url_origin("https://example.com:8443"),
            "https://example.com:8443"
        );
        assert_eq!(url_origin("https://example.com"), "https://example.com");
        assert_eq!(url_origin("not-a-url"), "not-a-url");
    }

    #[test]
    fn third_party_distinguishes_subdomain_from_origin() {
        assert!(is_third_party(
            "https://tracker.example.com",
            "https://other.com"
        ));
        // Same registrable domain → first party.
        assert!(!is_third_party(
            "https://a.example.com",
            "https://b.example.com"
        ));
        // Public suffix: a.b.example.co.uk vs example.co.uk.
        assert!(is_third_party(
            "https://a.b.example.co.uk",
            "https://example.com"
        ));
    }

    #[test]
    fn third_party_treats_ip_literal_as_first_party() {
        assert!(!is_third_party(
            "http://127.0.0.1:8080",
            "http://127.0.0.1:8080"
        ));
    }
}
