//! Native WebView2 camera, microphone and geolocation permission handling.

use crate::{PermissionRequestPayload, SitePermissionRule};
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[cfg(target_os = "windows")]
mod windows_guard {
    use super::*;
    use std::{cell::RefCell, collections::HashMap, sync::{atomic::{AtomicU64, Ordering}, Mutex, OnceLock}};
    use webview2_com::{CoTaskMemPWSTR, PermissionRequestedEventHandler};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
        COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DENY,
        ICoreWebView2Deferral, ICoreWebView2PermissionRequestedEventArgs,
    };

    struct Pending { args: ICoreWebView2PermissionRequestedEventArgs, deferral: ICoreWebView2Deferral }
    thread_local! { static PENDING: RefCell<HashMap<String, Pending>> = RefCell::new(HashMap::new()); }
    static LABELS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    fn labels() -> &'static Mutex<HashMap<String, String>> { LABELS.get_or_init(Default::default) }

    fn kind_name(kind: COREWEBVIEW2_PERMISSION_KIND) -> Option<&'static str> {
        if kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA { Some("camera") }
        else if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE { Some("microphone") }
        else if kind == COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION { Some("location") }
        else { None }
    }

    pub fn attach<R: Runtime>(app: &AppHandle<R>, label: &str, rules: Vec<SitePermissionRule>) {
        let Some(view) = app.get_webview(label) else { return };
        let event_app = app.clone();
        let event_label = label.to_string();
        let _ = view.with_webview(move |platform| {
            let Ok(core) = (unsafe { platform.controller().CoreWebView2() }) else { return };
            let handler = PermissionRequestedEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND(0);
                unsafe { args.PermissionKind(&mut kind) }?;
                let Some(kind_name) = kind_name(kind) else { return Ok(()) };
                let mut raw_uri = windows::core::PWSTR::null();
                unsafe { args.Uri(&mut raw_uri) }?;
                let uri = CoTaskMemPWSTR::from(raw_uri).to_string();
                let origin = url::Url::parse(&uri).ok().map(|url| url.origin().ascii_serialization()).unwrap_or(uri);
                let decision = rules.iter().find(|rule| rule.origin == origin).map(|rule| match kind_name {
                    "camera" => rule.camera.as_str(), "microphone" => rule.microphone.as_str(), "location" => rule.location.as_str(), _ => "ask",
                }).unwrap_or("ask");
                if decision != "ask" {
                    unsafe { args.SetState(if decision == "allow" { COREWEBVIEW2_PERMISSION_STATE_ALLOW } else { COREWEBVIEW2_PERMISSION_STATE_DENY })?; }
                    return Ok(());
                }
                let deferral = unsafe { args.GetDeferral()? };
                let request_id = format!("native-permission-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));
                PENDING.with(|map| map.borrow_mut().insert(request_id.clone(), Pending { args, deferral }));
                if let Ok(mut map) = labels().lock() { map.insert(request_id.clone(), event_label.clone()); }
                let _ = event_app.emit_to("main", "browser://permission-request", PermissionRequestPayload {
                    version: 2, request_id, origin, kind: kind_name.to_string(),
                });
                Ok(())
            }));
            let mut token = 0;
            let _ = unsafe { core.add_PermissionRequested(&handler, &mut token) };
        });
    }

    pub fn respond<R: Runtime>(app: &AppHandle<R>, request_id: &str, allow: bool) -> Result<Option<bool>, String> {
        let label = labels().lock().map_err(|_| "permission registry poisoned")?.remove(request_id);
        let Some(label) = label else { return Ok(None) };
        let view = app.get_webview(&label).ok_or_else(|| "permission webview no longer exists".to_string())?;
        let response_id = request_id.to_string();
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        view.with_webview(move |_| {
            let result = PENDING.with(|map| map.borrow_mut().remove(&response_id)).ok_or_else(|| "permission request expired".to_string()).and_then(|item| unsafe {
                item.args.SetState(if allow { COREWEBVIEW2_PERMISSION_STATE_ALLOW } else { COREWEBVIEW2_PERMISSION_STATE_DENY }).map_err(|error| error.to_string())?;
                item.deferral.Complete().map_err(|error| error.to_string())?;
                Ok(true)
            });
            let _ = sender.send(result);
        }).map_err(|error| error.to_string())?;
        receiver.recv_timeout(std::time::Duration::from_secs(5)).map_err(|_| "permission response timed out".to_string())?.map(Some)
    }
}

#[cfg(target_os = "windows")]
pub fn attach_permission_guard<R: Runtime>(app: &AppHandle<R>, label: &str, rules: Vec<SitePermissionRule>) { windows_guard::attach(app, label, rules) }
#[cfg(not(target_os = "windows"))]
pub fn attach_permission_guard<R: Runtime>(_app: &AppHandle<R>, _label: &str, _rules: Vec<SitePermissionRule>) {}

#[cfg(target_os = "windows")]
pub fn respond_native<R: Runtime>(app: &AppHandle<R>, request_id: &str, allow: bool) -> Result<Option<bool>, String> { windows_guard::respond(app, request_id, allow) }
#[cfg(not(target_os = "windows"))]
pub fn respond_native<R: Runtime>(_app: &AppHandle<R>, _request_id: &str, _allow: bool) -> Result<Option<bool>, String> { Ok(None) }
