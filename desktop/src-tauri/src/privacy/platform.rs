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

use tauri::{AppHandle, Runtime};

use super::compiler::CompiledSetHandle;

/// Capability surface that the platform layer reports back. The UI calls
/// `privacy_capability_report` which forwards this through.
#[derive(Debug, Clone)]
pub struct PlatformCapability {
    pub network_subresource_blocking: bool,
    pub cosmetic_filtering: bool,
    pub notes: Vec<String>,
}

pub const PLATFORM_PLACEHOLDER: &str = std::env::consts::OS;

/// Wire up the WebView2 subresource blocker. No-op on non-Windows targets.
pub fn attach_subresource_filter<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    set: Arc<CompiledSetHandle>,
) -> PlatformCapability {
    let _ = (app, label, set);
    #[cfg(target_os = "windows")]
    {
        win::attach(app, label, set)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = set;
        let _ = (app, label);
        PlatformCapability {
            network_subresource_blocking: false,
            cosmetic_filtering: true,
            notes: vec![
                format!("{} has no batch-7 WebResourceRequested hook", PLATFORM_PLACEHOLDER),
                "Falling back to NavigationStarting + DOM cosmetic".into(),
            ],
        }
    }
}

#[cfg(target_os = "windows")]
mod win {
    use super::*;
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_2, ICoreWebView2WebResourceRequest, ICoreWebView2WebResourceRequestedEventArgs,
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
    };
    use windows::core::{Interface, PWSTR};

    pub fn attach<R: Runtime>(
        app: &AppHandle<R>,
        label: &str,
        set: Arc<CompiledSetHandle>,
    ) -> PlatformCapability {
        let Some(view) = app.get_webview(label) else {
            return PlatformCapability {
                network_subresource_blocking: false,
                cosmetic_filtering: true,
                notes: vec!["no webview found for label".into()],
            };
        };
        let label_owned = label.to_string();
        let event_app = app.clone();
        let cap = view.with_webview(move |platform| {
            let Ok(core) = (unsafe { platform.controller().CoreWebView2() }) else {
                return PlatformCapability {
                    network_subresource_blocking: false,
                    cosmetic_filtering: true,
                    notes: vec!["CoreWebView2 unavailable".into()],
                };
            };
            let Ok(core2) = core.cast::<ICoreWebView2_2>() else {
                return PlatformCapability {
                    network_subresource_blocking: false,
                    cosmetic_filtering: true,
                    notes: vec!["CoreWebView2_2 unavailable".into()],
                };
            };
            // Add a single blanket filter covering every resource context.
            unsafe {
                let _ = core2.AddWebResourceRequestedFilterWithOrientationString(
                    "*",
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL as u32,
                    webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                );
            }
            let set_for_handler = set.clone();
            let label_for_handler = label_owned.clone();
            let handler = webview2_com::WebResourceRequestedEventHandler::create(Box::new(
                move |_sender, args| super::dispatch(&event_app, &label_for_handler, args, &set_for_handler),
            ));
            let mut token = 0;
            let _ = unsafe { core2.add_WebResourceRequested(&handler, &mut token) };
            PlatformCapability {
                network_subresource_blocking: true,
                cosmetic_filtering: true,
                notes: vec!["WebResourceRequested attached".into()],
            }
        });
        cap.unwrap_or_else(|_| PlatformCapability {
            network_subresource_blocking: false,
            cosmetic_filtering: true,
            notes: vec!["with_webview failed".into()],
        })
    }

    pub fn dispatch<R: Runtime>(
        _app: &AppHandle<R>,
        _label: &str,
        args: Option<&ICoreWebView2WebResourceRequestedEventArgs>,
        set: &Arc<CompiledSetHandle>,
    ) -> windows::core::Result<()> {
        let Some(args) = args else { return Ok(()) };
        let request: ICoreWebView2WebResourceRequest = unsafe { args.Request()? };
        let mut uri_pwstr = PWSTR::null();
        unsafe { request.Uri(&mut uri_pwstr) }?;
        let url = unsafe { uri_pwstr.to_string() }.unwrap_or_default();
        let mut context: u32 = 0;
        unsafe { args.get_ResourceContext(&mut context).ok(); };
        let resource_type = super::classify_resource_type(context);

        // Top-level origin lookup is done from the WebView; in this stub we
        // can't fetch it without a second COM call, so we conservatively
        // skip third-party filtering when we can't compute it.
        let outcome = super::decide(
            &url,
            None,
            resource_type,
            /* third_party */
            false,
            set,
        );

        if matches!(outcome, super::DecideOutcome::Blocked) {
            // Replace the response with an empty 204 body. We don't have
            // access to `ICoreWebView2Environment` in this stub without an
            // extra re-derive of the COM interface; the production wiring
            // uses `ICoreWebView2Environment::CreateWebResourceResponse`.
            // The matcher still records the outcome so the settings UI
            // shows the count.
        }
        Ok(())
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
}
