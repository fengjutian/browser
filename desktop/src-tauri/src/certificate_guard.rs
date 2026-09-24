//! Native WebView2 certificate-error interception and one-navigation override.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const CERTIFICATE_ERROR_EVENT: &str = "browser://certificate-error";
pub const CERTIFICATE_ERROR_CLEARED_EVENT: &str = "browser://certificate-error-cleared";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificateErrorPayload {
    pub request_id: String,
    pub url: String,
    pub message: String,
    pub repeated: bool,
}

pub fn emit_certificate_error<R: Runtime>(app: &AppHandle<R>, payload: CertificateErrorPayload) -> tauri::Result<()> {
    app.emit(CERTIFICATE_ERROR_EVENT, payload)
}

pub fn emit_certificate_error_cleared<R: Runtime>(app: &AppHandle<R>, request_id: &str) -> tauri::Result<()> {
    app.emit(CERTIFICATE_ERROR_CLEARED_EVENT, request_id.to_string())
}

pub fn guard_attached<R: Runtime>(app: &AppHandle<R>, window_label: &str) -> bool {
    app.get_webview_window(window_label).is_some()
}

#[cfg(target_os = "windows")]
mod windows_guard {
    use super::*;
    use std::{cell::RefCell, collections::HashMap, sync::{atomic::{AtomicU64, Ordering}, mpsc, Mutex, OnceLock}, time::Duration};
    use webview2_com::{ClearServerCertificateErrorActionsCompletedHandler, CoTaskMemPWSTR, ServerCertificateErrorDetectedEventHandler};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW,
        COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_CANCEL,
        COREWEBVIEW2_WEB_ERROR_STATUS,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED,
        COREWEBVIEW2_WEB_ERROR_STATUS_CLIENT_CERTIFICATE_CONTAINS_ERRORS,
        COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN,
        ICoreWebView2Deferral, ICoreWebView2ServerCertificateErrorDetectedEventArgs, ICoreWebView2_14,
    };
    use windows::core::Interface;

    struct Pending {
        args: ICoreWebView2ServerCertificateErrorDetectedEventArgs,
        deferral: ICoreWebView2Deferral,
    }

    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    thread_local! { static PENDING: RefCell<HashMap<String, Pending>> = RefCell::new(HashMap::new()); }
    static REQUEST_LABELS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    static URL_COUNTS: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();

    fn labels() -> &'static Mutex<HashMap<String, String>> { REQUEST_LABELS.get_or_init(Default::default) }
    fn counts() -> &'static Mutex<HashMap<String, u32>> { URL_COUNTS.get_or_init(Default::default) }

    fn status_message(status: COREWEBVIEW2_WEB_ERROR_STATUS) -> &'static str {
        if status == COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT { "证书中的域名与当前网站不匹配" }
        else if status == COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED { "网站证书已过期或尚未生效" }
        else if status == COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID { "网站证书无效" }
        else if status == COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED { "网站证书已被吊销" }
        else if status == COREWEBVIEW2_WEB_ERROR_STATUS_CLIENT_CERTIFICATE_CONTAINS_ERRORS { "客户端证书包含错误" }
        else { "TLS 证书验证失败" }
    }

    pub fn attach<R: Runtime>(app: &AppHandle<R>, label: &str) {
        let Some(view) = app.get_webview(label) else { return };
        let event_app = app.clone();
        let event_label = label.to_string();
        let _ = view.with_webview(move |platform| {
            let Ok(core) = (unsafe { platform.controller().CoreWebView2() }) else { return };
            let Ok(core14) = core.cast::<ICoreWebView2_14>() else { return };
            let handler = ServerCertificateErrorDetectedEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else { return Ok(()) };
                let deferral = unsafe { args.GetDeferral()? };
                let mut raw_uri = windows::core::PWSTR::null();
                unsafe { args.RequestUri(&mut raw_uri) }?;
                let uri = CoTaskMemPWSTR::from(raw_uri);
                let url = uri.to_string();
                let mut status = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
                unsafe { args.ErrorStatus(&mut status) }?;
                let request_id = format!("cert-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));
                let repeated = counts().lock().map(|mut map| {
                    let count = map.entry(url.clone()).or_insert(0); *count += 1; *count > 1
                }).unwrap_or(false);
                PENDING.with(|map| map.borrow_mut().insert(request_id.clone(), Pending { args, deferral }));
                if let Ok(mut map) = labels().lock() { map.insert(request_id.clone(), event_label.clone()); }
                let _ = emit_certificate_error(&event_app, CertificateErrorPayload {
                    request_id, url, message: status_message(status).to_string(), repeated,
                });
                Ok(())
            }));
            let mut token = 0;
            let _ = unsafe { core14.add_ServerCertificateErrorDetected(&handler, &mut token) };
        });
    }

    pub fn respond<R: Runtime>(app: AppHandle<R>, request_id: String, allow: bool) -> Result<(), String> {
        let label = labels().lock().map_err(|_| "certificate request registry poisoned")?
            .remove(&request_id).ok_or_else(|| "certificate request is no longer pending".to_string())?;
        let view = app.get_webview(&label).ok_or_else(|| "certificate webview no longer exists".to_string())?;
        let (sender, receiver) = mpsc::sync_channel(1);
        let response_id = request_id.clone();
        view.with_webview(move |_| {
            let result = PENDING.with(|map| map.borrow_mut().remove(&response_id)).ok_or_else(|| "certificate request is no longer pending".to_string()).and_then(|item| unsafe {
                item.args.SetAction(if allow { COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW } else { COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_CANCEL }).map_err(|e| e.to_string())?;
                item.deferral.Complete().map_err(|e| e.to_string())
            });
            let _ = sender.send(result);
        }).map_err(|e| e.to_string())?;
        receiver.recv_timeout(Duration::from_secs(5)).map_err(|_| "certificate response timed out".to_string())??;
        let _ = emit_certificate_error_cleared(&app, &request_id);
        if allow {
            let delayed_app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(3));
                if let Some(view) = delayed_app.get_webview(&label) {
                    let _ = view.with_webview(|platform| {
                        let Ok(core) = (unsafe { platform.controller().CoreWebView2() }) else { return };
                        let Ok(core14) = core.cast::<ICoreWebView2_14>() else { return };
                        let callback = ClearServerCertificateErrorActionsCompletedHandler::create(Box::new(|_| Ok(())));
                        let _ = unsafe { core14.ClearServerCertificateErrorActions(&callback) };
                    });
                }
            });
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
pub fn attach_certificate_guard<R: Runtime>(app: &AppHandle<R>, label: &str) { windows_guard::attach(app, label) }

#[cfg(not(target_os = "windows"))]
pub fn attach_certificate_guard<R: Runtime>(_app: &AppHandle<R>, _label: &str) {}

#[tauri::command]
pub fn browser_certificate_respond<R: Runtime>(app: AppHandle<R>, request_id: String, allow: bool) -> Result<(), String> {
    if request_id.is_empty() { return Err("request_id is required".into()) }
    #[cfg(target_os = "windows")]
    { windows_guard::respond(app, request_id, allow) }
    #[cfg(not(target_os = "windows"))]
    { let _ = (app, request_id, allow); Err("certificate override is only available on Windows/WebView2".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn payload_uses_frontend_camel_case_contract() {
        let value = serde_json::to_value(CertificateErrorPayload { request_id: "req-1".into(), url: "https://example.com".into(), message: "expired".into(), repeated: true }).unwrap();
        assert_eq!(value["requestId"], "req-1");
        assert!(value.get("request_id").is_none());
    }
}
