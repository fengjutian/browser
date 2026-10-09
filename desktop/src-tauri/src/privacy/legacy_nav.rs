//! Legacy WebView2 navigation-level filtering. Preserved verbatim from the
//! pre-batch-6 single-file privacy module — its top-level cancellation path
//! still runs alongside the new rule engine compiled from `privacy::compiler`.

use serde::Serialize;
use std::collections::HashSet;
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const NAV_BLOCKED_EVENT: &str = "browser://nav-blocked";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavBlockedEvent {
    pub tab_label: String,
    pub url: String,
    pub reason: String,
}

/// Top-level hosts we always refuse to navigate to, even if the user typed
/// them directly. Used as a baseline; the per-tab block list is layered on top
/// at runtime.
pub fn baseline_blocked_hosts() -> &'static HashSet<&'static str> {
    #[allow(clippy::ptr_arg)]
    fn inner() -> &'static HashSet<&'static str> {
        use std::sync::OnceLock;
        static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
        SET.get_or_init(|| {
            let mut s: HashSet<&'static str> = HashSet::new();
            for host in [
                "doubleclick.net",
                "googlesyndication.com",
                "googleadservices.com",
                "adservice.google.com",
                "pagead2.googlesyndication.com",
                "facebook.net",
                "connect.facebook.net",
            ] {
                s.insert(host);
            }
            s
        })
    }
    inner()
}

/// Per-tab extra block list, populated from the DOM-side blocker plus
/// user-configured hosts.
#[derive(Default)]
pub struct NavBlockRegistry {
    extra_hosts: std::sync::Mutex<Vec<String>>,
    counts: std::sync::Mutex<std::collections::HashMap<String, u64>>,
}

impl NavBlockRegistry {
    pub fn add_host(&self, host: String) {
        if let Ok(mut guard) = self.extra_hosts.lock() {
            let lower = host.to_ascii_lowercase();
            if !guard.iter().any(|existing| existing == &lower) {
                guard.push(lower);
            }
        }
    }
    pub fn remove_host(&self, host: &str) {
        if let Ok(mut guard) = self.extra_hosts.lock() {
            guard.retain(|existing| existing != host);
        }
    }
    pub fn snapshot_hosts(&self) -> Vec<String> {
        self.extra_hosts
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }
    pub fn record_block(&self, tab_label: &str) -> u64 {
        if let Ok(mut map) = self.counts.lock() {
            let entry = map.entry(tab_label.to_string()).or_insert(0);
            *entry += 1;
            return *entry;
        }
        0
    }
    pub fn count(&self, tab_label: &str) -> u64 {
        self.counts
            .lock()
            .ok()
            .and_then(|map| map.get(tab_label).copied())
            .unwrap_or(0)
    }
}

/// Returns true when the URL's host is part of the baseline block list.
pub fn is_blocked_host(url: &str) -> bool {
    match url::Url::parse(url) {
        Ok(parsed) => match parsed.host_str() {
            Some(host) => baseline_blocked_hosts()
                .iter()
                .any(|item| host == *item || host.ends_with(&format!(".{item}"))),
            None => false,
        },
        Err(_) => false,
    }
}

/// Subscribe to `NavigationStarting` so we can cancel requests to baseline
/// blocked hosts. On non-Windows targets this is a no-op.
pub fn attach_navigation_guard<R: Runtime>(app: &AppHandle<R>, label: &str) {
    #[cfg(target_os = "windows")]
    {
        win::attach(app, label);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label);
    }
}

#[cfg(target_os = "windows")]
fn handle_navigation<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2NavigationStartingEventArgs,
) -> windows::core::Result<()> {
    win::handle_navigation(app, label, args)
}

#[cfg(target_os = "windows")]
mod win {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2NavigationStartingEventArgs, ICoreWebView2_2,
    };
    use windows::core::{Interface, PWSTR};

    pub fn attach<R: tauri::Runtime>(app: &tauri::AppHandle<R>, label: &str) {
        let Some(view) = app.get_webview(label) else {
            return;
        };
        let event_label = label.to_string();
        let event_app = app.clone();
        let _ = view.with_webview(move |platform| {
            let Ok(core) = (unsafe { platform.controller().CoreWebView2() }) else {
                return;
            };
            let Ok(core2) = core.cast::<ICoreWebView2_2>() else {
                return;
            };
            let handler = webview2_com::NavigationStartingEventHandler::create(Box::new(
                move |_sender, args| {
                    let Some(args) = args else { return Ok(()) };
                    super::handle_navigation(&event_app, &event_label, &args)
                },
            ));
            let mut token = 0;
            let _ = unsafe { core2.add_NavigationStarting(&handler, &mut token) };
        });
    }

    pub fn handle_navigation<R: tauri::Runtime>(
        app: &tauri::AppHandle<R>,
        label: &str,
        args: &ICoreWebView2NavigationStartingEventArgs,
    ) -> windows::core::Result<()> {
        let mut uri = PWSTR::null();
        unsafe { args.Uri(&mut uri) }?;
        let url = unsafe { uri.to_string() }.unwrap_or_default();
        let blocked = super::is_blocked_host(&url);
        if !blocked {
            if let Some(reg) = app.try_state::<super::NavBlockRegistry>() {
                let host = url::Url::parse(&url)
                    .ok()
                    .and_then(|u| u.host_str().map(|s| s.to_ascii_lowercase()));
                if let Some(host) = host {
                    if reg
                        .snapshot_hosts()
                        .iter()
                        .any(|h| h == &host || host.ends_with(&format!(".{h}")))
                    {
                        return super::cancel_with_event(app, label, &url, "custom-blocklist");
                    }
                }
            }
            return Ok(());
        }
        super::cancel_with_event(app, label, &url, "baseline-tracking-host")
    }
}

#[cfg(target_os = "windows")]
fn cancel_with_event<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    url: &str,
    reason: &str,
) -> windows::core::Result<()> {
    if let Some(reg) = app.try_state::<NavBlockRegistry>() {
        reg.record_block(label);
    }
    let _ = app.emit(
        NAV_BLOCKED_EVENT,
        NavBlockedEvent {
            tab_label: label.to_string(),
            url: url.to_string(),
            reason: reason.to_string(),
        },
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn baseline_hosts_match_subdomain_and_bare() {
        assert!(is_blocked_host("https://doubleclick.net/foo"));
        assert!(is_blocked_host("https://ad.doubleclick.net/x"));
        assert!(is_blocked_host(
            "https://pagead2.googlesyndication.com/pagead/show_ads.js"
        ));
    }

    #[test]
    fn baseline_hosts_do_not_match_unrelated_hosts() {
        assert!(!is_blocked_host("https://example.com"));
        assert!(!is_blocked_host("not-a-url"));
        assert!(!is_blocked_host("https://docs.rs/rusqlite"));
    }

    #[test]
    fn nav_block_registry_dedupes_and_counts() {
        let reg = NavBlockRegistry::default();
        reg.add_host("tracker.example.com".into());
        reg.add_host("tracker.example.com".into());
        assert_eq!(reg.snapshot_hosts().len(), 1);
        assert_eq!(reg.record_block("tab-1"), 1);
        assert_eq!(reg.record_block("tab-1"), 2);
        assert_eq!(reg.count("tab-1"), 2);
        assert_eq!(reg.count("tab-2"), 0);
        reg.remove_host("tracker.example.com");
        assert!(reg.snapshot_hosts().is_empty());
    }
}
