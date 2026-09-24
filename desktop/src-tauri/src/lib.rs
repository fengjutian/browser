pub mod browser;
pub mod downloads;
pub mod local_store;
pub mod plugins;
pub mod providers;
pub mod session_lock;
pub mod webview_compat;
pub mod certificate_guard;
pub mod bookmarks;
pub mod process_memory;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use rusqlite::params;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::image::Image;
use tauri::webview::DownloadEvent;
use tauri::{Emitter, Manager};

use crate::providers::{AiProvider, ChatMessage, ChatRequest, ChatResponse};

const KEYRING_SERVICE: &str = "ai-knowledge-browser";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NewTabRequest {
    version: u32,
    opener_label: String,
    url: String,
    private: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PermissionRequestPayload {
    version: u32,
    request_id: String,
    origin: String,
    kind: String,
}

/// v2 download progress payload. The legacy v1 fields (`tabLabel`, `url`,
/// `path`, `status`) are preserved so existing consumers keep working; new
/// fields (`id`, `receivedBytes`, `totalBytes`, `progressKnown`,
/// `dangerType`, `kind`, `errorMessage`, `private`, `sourceOrigin`) extend
/// the contract.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    version: u32,
    kind: String, // started | progress | finished | failed | cancelled | blocked
    id: String,
    tab_label: String,
    url: String,
    file_name: String,
    target_path: Option<String>,
    mime_type: Option<String>,
    received_bytes: i64,
    total_bytes: Option<i64>,
    progress_known: bool,
    status: String,
    danger_type: String,
    error_message: Option<String>,
    private: bool,
    source_origin: Option<String>,
}

const EVENT_PAYLOAD_VERSION: u32 = 2;
#[allow(dead_code)] // referenced via string literal in started/finished handlers
const DOWNLOAD_EVENT_KIND_STARTED: &str = "started";
#[allow(dead_code)] // referenced via string literal in started/finished handlers
const DOWNLOAD_EVENT_KIND_FINISHED: &str = "finished";
#[allow(dead_code)] // referenced via string literal in started/finished handlers
const DOWNLOAD_EVENT_KIND_FAILED: &str = "failed";
#[allow(dead_code)] // wired up once reqwest streaming lands in batch 1 sub-batch B
const DOWNLOAD_EVENT_KIND_CANCELLED: &str = "cancelled";
#[allow(dead_code)]
const DOWNLOAD_EVENT_KIND_PROGRESS: &str = "progress";

#[derive(Default)]
struct DownloadIndex {
    by_url: Mutex<HashMap<String, String>>,
}

/// Round-trip registry for browser permission requests. The WebView's
/// permission_guard_script invokes `browser_permission_request`, which
/// generates a request id and emits `browser://permission-request` to the
/// main window. The host UI calls `respond(request_id, allow)` and we look
/// up the pending oneshot to deliver the verdict back to the WebView.
#[derive(Default)]
struct PermissionWaiters {
    pending: Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>,
}

impl PermissionWaiters {
    fn register(&self, request_id: String) -> tokio::sync::oneshot::Receiver<bool> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        if let Ok(mut guard) = self.pending.lock() {
            guard.insert(request_id, tx);
        }
        rx
    }
    fn resolve(&self, request_id: &str, allow: bool) -> bool {
        self.pending.lock().ok().and_then(|mut guard| guard.remove(request_id).map(|tx| tx.send(allow).is_ok())).unwrap_or(false)
    }
}

impl DownloadIndex {
    fn remember(&self, url: &str, id: &str) {
        if let Ok(mut guard) = self.by_url.lock() {
            guard.insert(url.to_string(), id.to_string());
        }
    }
    fn forget(&self, url: &str) -> Option<String> {
        self.by_url.lock().ok().and_then(|mut guard| guard.remove(url))
    }
    fn get(&self, url: &str) -> Option<String> {
        self.by_url.lock().ok().and_then(|guard| guard.get(url).cloned())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserCapabilities {
    /// True when granular byte-level download progress is observable.
    download_progress_bytes: bool,
    /// True when downloads can be paused/resumed through Tauri/WebView APIs.
    download_pause_resume: bool,
    /// True when in-flight downloads can be cancelled from the host.
    download_cancel: bool,
    /// True when a native permission-requested event is observable.
    native_permission_events: bool,
    /// True when a native context menu can be hooked to the webview.
    native_context_menu: bool,
    /// True when site data can be cleared through the host webview profile.
    clear_site_data: bool,
    /// True when TLS/certificate errors can be intercepted from code.
    certificate_error_interceptor: bool,
    /// Best-effort backend label for diagnostics ("webview2", "wkwebview", ...).
    webview_backend: Option<&'static str>,
    /// Tauri crate version compiled into the binary.
    tauri_runtime_version: Option<&'static str>,
}

#[tauri::command]
fn browser_capabilities() -> BrowserCapabilities {
    // Each flag reflects what the bundled Tauri 2 + wry + platform runtime can
    // do without extra native crates. See docs/browser-native-capability-matrix.md
    // for the source-of-truth citations.
    BrowserCapabilities {
        download_progress_bytes: true,   // tauri::webview::DownloadEvent::Progress
        download_pause_resume: false,    // not exposed by Tauri 2 stable; would need reqwest streaming
        download_cancel: true,           // return false from on_download Requested
        native_permission_events: false, // Tauri 2 stable does not surface PermissionRequested
        native_context_menu: false,      // wry has no context-menu integration in stable
        clear_site_data: false,          // wry does not expose WebView2 profile; webview2-com needed
        certificate_error_interceptor: false, // needs ICoreWebView2_5 ServerCertificateErrorDetected
        webview_backend: Some(webview_backend_label()),
        tauri_runtime_version: Some(env!("CARGO_PKG_VERSION")),
    }
}

#[cfg(target_os = "windows")]
fn webview_backend_label() -> &'static str { "webview2" }

#[cfg(target_os = "macos")]
fn webview_backend_label() -> &'static str { "wkwebview" }

#[cfg(target_os = "linux")]
fn webview_backend_label() -> &'static str { "webkitgtk" }

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn webview_backend_label() -> &'static str { "unknown" }

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SitePermissionRule {
    origin: String,
    camera: String, // "allow" | "deny" | "ask"
    microphone: String,
    location: String,
    notifications: String,
    clipboard: String,
}

/// Initialization script that intercepts the WebView's `contextmenu` event
/// and forwards a structured payload to the host. The host (BrowserPage)
/// renders the menu in window coordinates so the WebView never gets to
/// display its own context menu. URLs from `link` / `image` regions are
/// left as raw strings here; the frontend re-runs the navigation validator
/// before opening anything.
fn context_menu_script() -> String {
    r#"(() => {
      if (window.__arcadiaContextMenuInstalled) return;
      window.__arcadiaContextMenuInstalled = true;
      const emit = (payload) => {
        try {
          const internals = window.__TAURI_INTERNALS__;
          if (internals && typeof internals.invoke === 'function') {
            internals.invoke('tauri://emit', { event: 'browser://context-menu', payload }).catch(() => undefined);
          }
        } catch (error) { /* ignore */ }
      };
      document.addEventListener('contextmenu', event => {
        try {
          event.preventDefault();
          const target = event.target;
          if (!(target instanceof Element)) {
            emit({ kind: 'page', clientX: event.clientX, clientY: event.clientY, selectionText: '', linkUrl: null, imageUrl: null, editable: false });
            return;
          }
          const editable = target instanceof HTMLInputElement
            || target instanceof HTMLTextAreaElement
            || (target instanceof HTMLElement && target.isContentEditable);
          if (editable) {
            emit({ kind: 'input', clientX: event.clientX, clientY: event.clientY, selectionText: '', linkUrl: null, imageUrl: null, editable: true });
            return;
          }
          // Walk up to find a link or image ancestor. Image wins over link
          // when an <img> is wrapped in an <a>.
          let node = target;
          let linkUrl = null;
          let imageUrl = null;
          while (node && node !== document.body) {
            if (!linkUrl && node instanceof HTMLAnchorElement && node.href) {
              linkUrl = node.href;
            }
            if (!imageUrl && node instanceof HTMLImageElement && node.src) {
              imageUrl = node.src;
            }
            if (linkUrl && imageUrl) break;
            node = node.parentElement;
          }
          const selectionText = window.getSelection ? String(window.getSelection() || '') : '';
          let kind;
          if (imageUrl) kind = 'image';
          else if (linkUrl) kind = 'link';
          else if (selectionText && selectionText.length > 0) kind = 'selection';
          else kind = 'page';
          emit({ kind, clientX: event.clientX, clientY: event.clientY, selectionText, linkUrl, imageUrl, editable: false });
        } catch (error) {
          emit({ kind: 'page', clientX: event.clientX, clientY: event.clientY, selectionText: '', linkUrl: null, imageUrl: null, editable: false });
        }
      }, true);
    })()"#
        .into()
}

fn ad_blocker_script(label: &str, enabled: bool) -> String {
    let label = serde_json::to_string(label).unwrap_or_else(|_| "\"browser\"".into());
    format!(r#"(() => {{
      if (window.__arcadiaAdBlocker) {{ window.__arcadiaAdBlocker.setEnabled({enabled}); return; }}
      const tabLabel = {label};
      const blockedHosts = [
        'doubleclick.net','googlesyndication.com','googleadservices.com','adservice.google.com',
        'amazon-adsystem.com','scorecardresearch.com','taboola.com','outbrain.com',
        'pos.baidu.com','cpro.baidu.com','alimama.com','tanx.com','admaster.com.cn'
      ];
      const selectors = [
        '[data-ad-client]','[data-ad-slot]','ins.adsbygoogle','iframe[id^="google_ads"]',
        'iframe[src*="doubleclick.net"]','iframe[src*="googlesyndication.com"]',
        '.advertisement','.advertising','[aria-label="Advertisement"]','[aria-label="广告"]'
      ];
      const seen = new WeakSet();
      let blockedCount = 0;
      let active = {enabled};
      let style;
      const emit = () => {{
        try {{
          const internals = window.__TAURI_INTERNALS__;
          if (internals && typeof internals.invoke === 'function')
            internals.invoke('tauri://emit', {{ event: 'browser://ad-block-update', payload: {{ version: 1, tabLabel, blockedCount }} }}).catch(() => undefined);
        }} catch (_) {{}}
      }};
      const isBlockedUrl = value => {{
        try {{ const host = new URL(value, location.href).hostname.toLowerCase(); return blockedHosts.some(item => host === item || host.endsWith('.' + item)); }}
        catch (_) {{ return false; }}
      }};
      const block = node => {{
        if (!active || !(node instanceof Element) || seen.has(node)) return;
        let matched = selectors.some(selector => {{ try {{ return node.matches(selector); }} catch (_) {{ return false; }} }});
        const resourceUrl = node.getAttribute('src') || node.getAttribute('href') || '';
        matched = matched || (!!resourceUrl && isBlockedUrl(resourceUrl));
        if (matched) {{ seen.add(node); node.remove(); blockedCount += 1; emit(); return; }}
        node.querySelectorAll('iframe,img,script,link,ins,[data-ad-client],[data-ad-slot]').forEach(block);
      }};
      const applyStyle = () => {{
        if (style || !document.documentElement) return;
        style = document.createElement('style'); style.id = 'arcadia-ad-blocker-style';
        style.textContent = selectors.join(',') + '{{display:none!important;visibility:hidden!important}}';
        (document.head || document.documentElement).appendChild(style);
      }};
      const observer = new MutationObserver(records => {{ if (active) records.forEach(record => record.addedNodes.forEach(block)); }});
      const start = () => {{ applyStyle(); if (document.documentElement) {{ block(document.documentElement); observer.observe(document.documentElement, {{ childList:true, subtree:true }}); }} }};
      window.__arcadiaAdBlocker = {{ setEnabled(value) {{ active=!!value; if (active) start(); else {{ observer.disconnect(); style?.remove(); style=undefined; }} emit(); }} }};
      if (active) {{ if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {{once:true}}); else start(); }}
      emit();
    }})()"#)
}

#[cfg(test)]
mod context_menu_tests {
    #[test]
    fn context_menu_script_is_a_single_expression() {
        let script = super::context_menu_script();
        assert!(script.starts_with("(() =>"), "script must be an IIFE");
        assert!(script.contains("contextmenu"), "script must intercept contextmenu events");
    }
}

fn permission_guard_script(rules: &[SitePermissionRule]) -> String {
    let rules = serde_json::to_string(rules).unwrap_or_else(|_| "[]".into());
    // Each sensitive JS API is wrapped: the wrapper inspects the current
    // rule for (origin, kind). `allow` keeps the original behaviour;
    // `deny` rejects the call; `ask` invokes `browser_permission_request`
    // which round-trips through the host UI and resolves / rejects based
    // on the user's verdict.
    format!(r#"(()=>{{
      const rules={rules};
      const origin=location.origin;
      const rule=rules.find(item=>item.origin===origin) || {{}};
      const denied=name=>new DOMException(name+' permission denied by Arcadia','NotAllowedError');
      const decide=(kind)=>{{
        const value=rule[kind];
        if(value==='allow') return 'allow';
        if(value==='deny') return 'deny';
        return 'ask';
      }};
      const ask=(kind)=>async ()=>{{
        const id=globalThis.crypto?.randomUUID ? crypto.randomUUID() : String(Math.random());
        try {{
          const allow=await window.__TAURI_INTERNALS__.invoke('browser_permission_request', {{ requestId: id, origin, kind, timeoutMs: 15000 }});
          if(!allow) throw denied(kind);
          return true;
        }} catch (error) {{ throw error instanceof Error ? error : denied(kind); }}
      }};
      if(navigator.mediaDevices?.getUserMedia){{
        const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia=async (constraints)=>{{
          const wantsCamera=!!(constraints && constraints.video);
          const wantsMic=!!(constraints && constraints.audio);
          const camDecision=wantsCamera ? decide('camera') : 'allow';
          const micDecision=wantsMic ? decide('microphone') : 'allow';
          if(camDecision==='deny'||micDecision==='deny') throw denied('Media');
          if(camDecision==='ask'||micDecision==='ask') {{
            const kind = wantsCamera&&wantsMic ? 'media' : (wantsCamera ? 'camera' : 'microphone');
            await ask(kind)();
          }}
          return original(constraints);
        }};
      }}
      if(navigator.geolocation){{
        const reject=(_,error)=>error?.({{code:1,message:'Location permission denied by Arcadia'}});
        const wrap=(original)=>(success,error)=>{{
          const decision=decide('location');
          if(decision==='deny') return reject(success, error);
          if(decision==='ask') {{
            ask('location')().then(()=>{{ try {{ original(success,error); }} catch {{}} }}).catch(()=>reject(success, error));
            return;
          }}
          try {{ original(success,error); }} catch {{ reject(success,error); }}
        }};
        navigator.geolocation.getCurrentPosition=wrap(navigator.geolocation.getCurrentPosition.bind(navigator.geolocation));
        navigator.geolocation.watchPosition=wrap(navigator.geolocation.watchPosition.bind(navigator.geolocation));
      }}
      if(globalThis.Notification){{
        try {{
          const decision=decide('notifications');
          if(decision==='deny') {{
            Notification.requestPermission=()=>Promise.resolve('denied');
          }} else if(decision==='ask') {{
            Notification.requestPermission=()=>ask('notifications')().then(()=>'granted').catch(()=>'denied');
          }}
          // `allow`: pass through; WebView2 stable will still return 'denied' without extra crate.
        }} catch {{}}
      }}
      if(navigator.clipboard){{
        try {{
          const wrap=(method)=>async ()=>{{
            const decision=decide('clipboard');
            if(decision==='deny') throw denied('Clipboard');
            if(decision==='ask') await ask('clipboard')();
            return method.call(navigator.clipboard);
          }};
          navigator.clipboard.read=wrap(navigator.clipboard.read);
          navigator.clipboard.readText=wrap(navigator.clipboard.readText);
        }} catch {{}}
      }}
    }})()"#)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserState {
    url: String,
    title: String,
    favicon: Option<String>,
    loading: bool,
    #[serde(default)]
    scroll_x: f64,
    #[serde(default)]
    scroll_y: f64,
    #[serde(default)]
    scroll_depth: f64,
    #[serde(default)]
    can_go_back: bool,
    #[serde(default)]
    can_go_forward: bool,
}

#[derive(Default)]
struct NavStacks {
    stacks: Mutex<HashMap<String, NavStack>>,
}

#[derive(Default)]
struct NavStack {
    entries: Vec<String>,
    index: usize,
}

impl NavStack {
    fn push(&mut self, url: String) {
        if let Some(pos) = self.entries.get(self.index + 1..).and_then(|_| Some(self.index + 1)) {
            self.entries.truncate(pos);
        }
        if self.entries.last().map(|last| last == &url).unwrap_or(false) {
            return;
        }
        self.entries.push(url);
        self.index = self.entries.len() - 1;
    }

    fn back(&mut self) -> bool {
        if self.index == 0 { return false; }
        self.index -= 1;
        true
    }

    fn forward(&mut self) -> bool {
        if self.index + 1 >= self.entries.len() { return false; }
        self.index += 1;
        true
    }

    fn can_go_back(&self) -> bool { self.index > 0 }
    fn can_go_forward(&self) -> bool { self.index + 1 < self.entries.len() }

    fn observe(&mut self, url: String) {
        if self.entries.is_empty() {
            self.push(url);
            return;
        }
        if self.entries.get(self.index) == Some(&url) {
            return;
        }
        if self.index > 0 && self.entries.get(self.index - 1) == Some(&url) {
            self.index -= 1;
            return;
        }
        if self.entries.get(self.index + 1) == Some(&url) {
            self.index += 1;
            return;
        }
        self.push(url);
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct PageSnapshot {
    url: String,
    html: String,
}

#[tauri::command]
fn validate_navigation(url: String) -> Result<String, String> {
    browser::normalize_navigation(&url).map_err(|error| error.to_string())
}

fn external_url(input: &str) -> Result<url::Url, String> {
    let parsed = if let Ok(explicit) = url::Url::parse(input.trim()) {
        explicit
    } else {
        let normalized = browser::normalize_navigation(input).map_err(|error| error.to_string())?;
        url::Url::parse(&normalized).map_err(|error| error.to_string())?
    };
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        scheme if matches!(scheme, "mailto" | "tel" | "sms") => {
            Err(format!("external-protocol:{scheme}"))
        }
        scheme if matches!(scheme, "file" | "javascript" | "data" | "vbscript" | "about" | "chrome") => {
            Err(format!("blocked-protocol:{scheme}"))
        }
        scheme => Err(format!("unknown-protocol:{scheme}")),
    }
}

fn validate_browser_label(label: &str) -> Result<(), String> {
    let suffix = label.strip_prefix("browser-").ok_or_else(|| "invalid browser webview label".to_string())?;
    if suffix.is_empty() || label.len() > 96 || !suffix.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-') {
        return Err("invalid browser webview label".into());
    }
    Ok(())
}

fn audio_monitor_script(label: &str) -> String {
    format!(r#"(() => {{
      let muted=false, last='';
      const media=()=>Array.from(document.querySelectorAll('audio,video'));
      const emit=()=>{{
        const audible=!muted&&media().some(node=>!node.paused&&!node.ended&&node.volume>0&&!node.muted);
        const signature=`${{audible}}:${{muted}}`;
        if(signature===last)return;last=signature;
        window.__TAURI_INTERNALS__?.invoke('tauri://emit',{{event:'browser://audio-state',payload:{{version:1,tabLabel:'{label}',audible,muted}}}}).catch(()=>undefined);
      }};
      const bind=node=>{{if(!(node instanceof HTMLMediaElement)||node.dataset.arcadiaAudioBound)return;node.dataset.arcadiaAudioBound='1';if(muted)node.muted=true;for(const event of ['play','playing','pause','ended','volumechange','emptied'])node.addEventListener(event,emit)}};
      const scan=()=>{{media().forEach(bind);emit()}};
      new MutationObserver(scan).observe(document,{{subtree:true,childList:true}});
      document.addEventListener('DOMContentLoaded',scan,{{once:true}});scan();
      window.__arcadiaAudio={{setMuted(value){{muted=!!value;media().forEach(node=>{{node.muted=muted}});emit()}},state(){{return{{muted}}}}}};
    }})()"#)
}

#[tauri::command]
async fn browser_create(
    app: tauri::AppHandle,
    label: String,
    url: String,
    bounds: BrowserBounds,
    permissions: Option<Vec<SitePermissionRule>>,
    ad_block_enabled: Option<bool>,
    private: Option<bool>,
) -> Result<(), String> {
    validate_browser_label(&label)?;
    if app.get_webview(&label).is_some() {
        return Ok(());
    }
    let url = external_url(&url)?;
    let nav_url = url.to_string();
    let opener_label = label.clone();
    let event_app = app.clone();
    let download_app = app.clone();
    let download_label = label.clone();
    let private_mode = private.unwrap_or(false);
    let builder = tauri::webview::WebviewBuilder::new(&label, tauri::WebviewUrl::External(url))
        .incognito(private_mode)
        .initialization_script(permission_guard_script(permissions.as_deref().unwrap_or(&[])))
        .initialization_script(context_menu_script())
        .initialization_script(audio_monitor_script(&label))
        .initialization_script(ad_blocker_script(&label, ad_block_enabled.unwrap_or(true)))
        .on_new_window(move |url, _features| {
            if matches!(url.scheme(), "http" | "https") {
                let _ = event_app.emit_to(
                    "main",
                    "browser://new-tab",
                    NewTabRequest {
                        version: EVENT_PAYLOAD_VERSION,
                        opener_label: opener_label.clone(),
                        url: url.to_string(),
                        private: private_mode,
                    },
                );
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .on_download(move |_webview, event| {
            let label = download_label.clone();
            let app = download_app.clone();
            match event {
                DownloadEvent::Requested { url, destination } => {
                    let url_str = url.to_string();
                    let dest_str = destination.to_string_lossy().into_owned();
                    let file_name = destination
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|s| s.to_owned())
                        .unwrap_or_else(|| "download".to_string());
                    tauri::async_runtime::spawn(async move {
                        handle_download_started(app, label, url_str, dest_str, file_name, private_mode).await;
                    });
                }
                DownloadEvent::Finished { url, path, success } => {
                    let url_str = url.to_string();
                    let path_str = path.map(|value| value.to_string_lossy().into_owned());
                    tauri::async_runtime::spawn(async move {
                        handle_download_finished(app, label, url_str, path_str, success, private_mode).await;
                    });
                }
                _ => {}
            }
            true
        });
    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window
        .add_child(
            builder,
            tauri::LogicalPosition::new(bounds.x, bounds.y),
            tauri::LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)),
        )
        .map_err(|error| error.to_string())?;
    // Hook the certificate-error stub onto the freshly created window. When
    // webview2-com exposes a stable ICoreWebView2_5 binding, swap the stub
    // for a real ServerCertificateErrorDetected registration that defers
    // navigation until the user accepts.
    certificate_guard::attach_certificate_guard(&app, &label);
    let navs = app.state::<NavStacks>();
    let mut guard = navs.stacks.lock().map_err(|_| "nav stack poisoned".to_string())?;
    let stack = guard.entry(label).or_default();
    stack.push(nav_url);
    Ok(())
}

#[tauri::command]
async fn browser_set_ad_blocking(app: tauri::AppHandle, label: String, enabled: bool) -> Result<(), String> {
    validate_browser_label(&label)?;
    app.get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?
        .eval(format!("window.__arcadiaAdBlocker?.setEnabled({enabled})"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn browser_set_muted(app: tauri::AppHandle, label: String, muted: bool) -> Result<(), String> {
    validate_browser_label(&label)?;
    app.get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?
        .eval(format!("window.__arcadiaAudio?.setMuted({muted})"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn browser_navigate(
    app: tauri::AppHandle,
    label: String,
    url: String,
) -> Result<String, String> {
    validate_browser_label(&label)?;
    let url = external_url(&url)?;
    app.get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?
        .navigate(url.clone())
        .map_err(|error| error.to_string())?;
    let navs = app.state::<NavStacks>();
    let mut guard = navs.stacks.lock().map_err(|_| "nav stack poisoned".to_string())?;
    let stack = guard.entry(label).or_default();
    stack.push(url.to_string());
    Ok(url.to_string())
}

#[tauri::command]
async fn browser_reload(app: tauri::AppHandle, label: String) -> Result<(), String> {
    validate_browser_label(&label)?;
    app.get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?
        .reload()
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn browser_stop(app: tauri::AppHandle, label: String) -> Result<(), String> {
    validate_browser_label(&label)?;
    app.get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?
        .eval("window.stop()")
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn browser_edit_action(app: tauri::AppHandle, label: String, action: String) -> Result<(), String> {
    validate_browser_label(&label)?;
    let script = match action.as_str() {
        "cut" => "document.execCommand('cut')",
        "paste" => "navigator.clipboard.readText().then(t=>document.execCommand('insertText',false,t)).catch(()=>{})",
        "select-all" => "(()=>{const e=document.activeElement;if(e&&('select' in e)&&typeof e.select==='function')e.select();else document.execCommand('selectAll')})()",
        _ => return Err("unsupported edit action".into()),
    };
    app.get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?
        .eval(script)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn browser_clear_page_data(app: tauri::AppHandle, label: String) -> Result<(), String> {
    validate_browser_label(&label)?;
    app.get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?
        .eval("(()=>{try{localStorage.clear()}catch{}try{sessionStorage.clear()}catch{}try{document.cookie.split(';').forEach(c=>{const n=c.split('=')[0].trim();document.cookie=n+'=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/'})}catch{}try{caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k))))}catch{}try{indexedDB.databases?.().then(dbs=>dbs.forEach(db=>db.name&&indexedDB.deleteDatabase(db.name)))}catch{}})()")
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn browser_find(
    app: tauri::AppHandle,
    label: String,
    query: String,
    backwards: bool,
) -> Result<bool, String> {
    validate_browser_label(&label)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?;
    if query.is_empty() {
        webview
            .eval("window.getSelection()?.removeAllRanges()")
            .map_err(|error| error.to_string())?;
        return Ok(false);
    }
    let query = serde_json::to_string(&query).map_err(|error| error.to_string())?;
    eval_json(
        webview,
        &format!("window.find({query},false,{backwards},true,false,true,false)"),
    )
    .await
}

#[tauri::command]
async fn browser_zoom(app: tauri::AppHandle, label: String, scale: f64) -> Result<(), String> {
    validate_browser_label(&label)?;
    if !(0.5..=3.0).contains(&scale) {
        return Err("zoom scale must be between 0.5 and 3.0".into());
    }
    app.get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?
        .eval(format!("document.documentElement.style.zoom={scale}"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn browser_print(app: tauri::AppHandle, label: String) -> Result<(), String> {
    validate_browser_label(&label)?;
    app.get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?
        .eval("window.print()")
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn browser_history(app: tauri::AppHandle, label: String, delta: i32) -> Result<(), String> {
    validate_browser_label(&label)?;
    if !(-1..=1).contains(&delta) || delta == 0 {
        return Err("history delta must be -1 or 1".into());
    }
    {
        let navs = app.state::<NavStacks>();
        let mut guard = navs.stacks.lock().map_err(|_| "nav stack poisoned".to_string())?;
        let stack = guard.entry(label.clone()).or_default();
        let moved = match delta {
            -1 => stack.back(),
            1 => stack.forward(),
            _ => unreachable!(),
        };
        if !moved {
            return Err("history navigation unavailable".into());
        }
    }
    app.get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?
        .eval(format!("history.go({delta})"))
        .map_err(|error| error.to_string())
}

async fn eval_json<T: DeserializeOwned + Send + 'static>(
    webview: tauri::Webview,
    script: &str,
) -> Result<T, String> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    webview
        .eval_with_callback(script, move |result| {
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
    let result =
        tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(5)))
            .await
            .map_err(|error| error.to_string())?
            .map_err(|_| "page script timed out".to_string())?;
    serde_json::from_str(&result).map_err(|error| format!("invalid page response: {error}"))
}

#[tauri::command]
async fn browser_state(app: tauri::AppHandle, label: String) -> Result<BrowserState, String> {
    validate_browser_label(&label)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?;
    let mut state: BrowserState = eval_json(
        webview,
        "({url:location.href,title:document.title,favicon:(document.querySelector('link[rel~=icon]')?.href??null),loading:document.readyState!=='complete',scrollX:window.scrollX,scrollY:window.scrollY,scrollDepth:Math.min(1,(window.scrollY+window.innerHeight)/Math.max(document.documentElement.scrollHeight,window.innerHeight))})",
    )
    .await?;
    let navs = app.state::<NavStacks>();
    let mut guard = navs.stacks.lock().map_err(|_| "nav stack poisoned".to_string())?;
    let stack = guard.entry(label).or_default();
    stack.observe(state.url.clone());
    state.can_go_back = stack.can_go_back();
    state.can_go_forward = stack.can_go_forward();
    Ok(state)
}

#[tauri::command]
fn browser_restore_scroll(app: tauri::AppHandle, label: String, x: f64, y: f64) -> Result<(), String> {
    validate_browser_label(&label)?;
    if !x.is_finite() || !y.is_finite() {
        return Err("invalid scroll position".into());
    }
    app.get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?
        .eval(format!("window.scrollTo({}, {})", x.max(0.0), y.max(0.0)))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn browser_toolbar_menu(app: tauri::AppHandle, label: String, open: bool, zoom_percent: u16) -> Result<(), String> {
    validate_browser_label(&label)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?;
    let script = if !open {
        "window.__arcadiaToolbarMenu?.close(false)".to_string()
    } else {
        format!(r#"(() => {{
          window.__arcadiaToolbarMenu?.close(false);
          const host = document.createElement('div');
          host.id = '__arcadia-toolbar-menu';
          const shadow = host.attachShadow({{mode:'closed'}});
          const emit = action => window.__TAURI_INTERNALS__?.invoke('tauri://emit', {{event:'browser://toolbar-menu-action', payload:{{version:1,tabLabel:'{label}',action}}}}).catch(()=>undefined);
          const close = (notify=true) => {{ document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keydown, true); host.remove(); delete window.__arcadiaToolbarMenu; if(notify) emit('__dismiss__'); }};
          const outside = event => {{ if(!event.composedPath().includes(host)) close(); }};
          const keydown = event => {{ if(event.key === 'Escape') close(); }};
          const items = [
            ['find','在页面中查找'],['tab-search','搜索标签页'],['history-search','浏览历史记录'],
            ['bookmark-add','收藏当前页'],['bookmarks','打开收藏夹'],['bulk-summary','多链接 AI 摘要'],
            ['toggle-notes','网页笔记面板'],['save-workspace','保存当前标签为工作区'],['translate-page','翻译当前网页'],['print','打印 / 保存为 PDF'],['clear-site-data','清除此网站数据'],
            null,['new-private','新建私密窗口'],['fullscreen','进入全屏'],null
          ];
          const style = document.createElement('style');
          style.textContent = `
            :host{{all:initial}} .menu{{font:14px/1.4 system-ui,"Microsoft YaHei",sans-serif;color:#202521;background:#fff;border:1px solid #d9dfda;border-radius:12px;box-shadow:0 12px 32px rgba(20,35,27,.18);padding:8px;width:224px;box-sizing:border-box}}
            button{{all:unset;box-sizing:border-box;display:block;width:100%;padding:9px 10px;border-radius:7px;cursor:pointer}} button:hover{{background:#edf5ef}} .sep{{height:1px;background:#e1e6e2;margin:5px 2px}} .zoom{{display:grid;grid-template-columns:34px 1fr 34px;align-items:center;gap:6px;padding:5px 3px}} .zoom button{{padding:6px;text-align:center;border:1px solid #d9dfda;background:#fff}} .zoom span{{text-align:center;font:13px system-ui}}
          `;
          const menu = document.createElement('div');
          menu.className = 'menu'; menu.setAttribute('role', 'menu');
          shadow.append(style, menu);
          for(const item of items) {{
            if(!item) {{ const sep=document.createElement('div'); sep.className='sep'; menu.append(sep); continue; }}
            const button=document.createElement('button'); button.type='button'; button.textContent=item[1]; button.onclick=()=>{{emit(item[0]);close(false)}}; menu.append(button);
          }}
          const zoom=document.createElement('div'); zoom.className='zoom';
          zoom.innerHTML='<button type="button" data-action="zoom-out">−</button><span>{zoom_percent}%</span><button type="button" data-action="zoom-in">+</button>';
          zoom.querySelectorAll('button').forEach(button=>button.onclick=event=>{{event.stopPropagation();emit(button.dataset.action)}}); menu.append(zoom);
          const reset=document.createElement('button'); reset.type='button'; reset.textContent='重置缩放'; reset.onclick=()=>{{emit('zoom-reset');close(false)}}; menu.append(reset);
          Object.assign(host.style,{{position:'fixed',top:'8px',right:'8px',zIndex:'2147483647'}});
          document.documentElement.append(host);
          setTimeout(()=>{{document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',keydown,true)}},0);
          window.__arcadiaToolbarMenu={{close}};
        }})()"#)
    };
    webview.eval(script).map_err(|error| error.to_string())
}

#[tauri::command]
fn browser_toolbar_panel(
    app: tauri::AppHandle,
    label: String,
    open: bool,
    kind: String,
    payload: String,
) -> Result<(), String> {
    validate_browser_label(&label)?;
    if !matches!(kind.as_str(), "downloads" | "bookmarks" | "resources") {
        return Err("unsupported toolbar panel".into());
    }
    let data: serde_json::Value = serde_json::from_str(&payload)
        .map_err(|error| format!("invalid toolbar panel payload: {error}"))?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?;
    if !open {
        return webview
            .eval("window.__arcadiaToolbarMenu?.close(false)")
            .map_err(|error| error.to_string());
    }
    let kind_js = serde_json::to_string(&kind).map_err(|error| error.to_string())?;
    let data_js = serde_json::to_string(&data).map_err(|error| error.to_string())?;
    let script = format!(r#"(() => {{
      window.__arcadiaToolbarMenu?.close(false);
      const kind={kind_js}, data={data_js};
      const host=document.createElement('div'); host.id='__arcadia-toolbar-panel';
      const shadow=host.attachShadow({{mode:'closed'}});
      const emit=(action,value)=>window.__TAURI_INTERNALS__?.invoke('tauri://emit',{{event:'browser://toolbar-menu-action',payload:{{version:1,tabLabel:'{label}',action,value}}}}).catch(()=>undefined);
      const close=(notify=true)=>{{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',keydown,true);host.remove();delete window.__arcadiaToolbarMenu;if(notify)emit('__dismiss__')}};
      const outside=event=>{{if(!event.composedPath().includes(host))close()}};
      const keydown=event=>{{if(event.key==='Escape')close()}};
      shadow.innerHTML=`<style>
        :host{{all:initial}}*{{box-sizing:border-box}}.panel{{width:340px;max-height:68vh;overflow:auto;padding:12px;font:13px/1.45 system-ui,"Microsoft YaHei",sans-serif;color:#202521;background:#fff;border:1px solid #d9dfda;border-radius:12px;box-shadow:0 12px 32px rgba(20,35,27,.2)}}
        .head{{display:flex;justify-content:space-between;align-items:center;margin-bottom:9px}}.head b{{font-size:15px}}.muted{{color:#748078;font-size:12px}}.empty{{padding:24px 8px;text-align:center;color:#748078}}
        .row{{display:flex;justify-content:space-between;gap:12px;padding:7px 5px;border-top:1px solid #eef1ef}}.row:first-child{{border-top:0}}.stack{{display:block;width:100%}}.stack b,.stack span{{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}.stack span{{margin-top:2px;color:#748078;font-size:11px}}
        button{{all:unset;box-sizing:border-box;display:block;width:100%;padding:8px;border-radius:7px;cursor:pointer}}button:hover{{background:#edf5ef}}.section{{margin-top:12px;color:#4c9167;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase}}
      </style><div class="panel" role="dialog"></div>`;
      const panel=shadow.querySelector('.panel');
      const head=(title,subtitle)=>{{const node=document.createElement('div');node.className='head';const bold=document.createElement('b');bold.textContent=title;const small=document.createElement('span');small.className='muted';small.textContent=subtitle||'';node.append(bold,small);panel.append(node)}};
      const empty=text=>{{const node=document.createElement('div');node.className='empty';node.textContent=text;panel.append(node)}};
      const row=(label,value)=>{{const node=document.createElement('div');node.className='row';const left=document.createElement('span');left.textContent=label;const right=document.createElement('b');right.textContent=value;node.append(left,right);panel.append(node)}};
      if(kind==='bookmarks'){{
        head('收藏夹',`${{data.total||0}} 条`);
        if(!data.items?.length)empty('还没有收藏，Ctrl+D 收藏当前页');
        for(const item of data.items||[]){{const button=document.createElement('button');button.type='button';button.className='stack';const title=document.createElement('b');title.textContent=item.title||item.url;const url=document.createElement('span');url.textContent=item.url;button.append(title,url);button.onclick=()=>{{emit('bookmark-open',item.url);close(false)}};panel.append(button)}}
        if((data.total||0)>(data.items?.length||0)){{const button=document.createElement('button');button.type='button';button.textContent=`查看全部 ${{data.total}} 条`;button.onclick=()=>{{emit('bookmarks');close(false)}};panel.append(button)}}
      }} else if(kind==='downloads'){{
        head('下载',data.subtitle||'暂无活动');
        if(!data.items?.length)empty('暂无下载');
        for(const item of data.items||[]){{const node=document.createElement('div');node.className='row stack';const title=document.createElement('b');title.textContent=item.name;const status=document.createElement('span');status.textContent=item.detail||item.status;node.append(title,status);panel.append(node)}}
      }} else {{
        head('资源面板',data.subtitle||'');
        for(const section of data.sections||[]){{const title=document.createElement('div');title.className='section';title.textContent=section.title;panel.append(title);for(const item of section.items||[])row(item.label,String(item.value))}}
        if(data.hint){{const hint=document.createElement('p');hint.className='muted';hint.textContent=data.hint;panel.append(hint)}}
      }}
      Object.assign(host.style,{{position:'fixed',top:'8px',right:'8px',zIndex:'2147483647'}});document.documentElement.append(host);
      setTimeout(()=>{{document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',keydown,true)}},0);window.__arcadiaToolbarMenu={{close}};
    }})()"#);
    webview.eval(script).map_err(|error| error.to_string())
}

#[tauri::command]
async fn browser_snapshot(app: tauri::AppHandle, label: String) -> Result<PageSnapshot, String> {
    validate_browser_label(&label)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?;
    let snapshot: PageSnapshot = eval_json(
        webview,
        "({url:location.href,html:document.documentElement.outerHTML})",
    )
    .await?;
    if snapshot.html.len() > 8 * 1024 * 1024 {
        return Err("page snapshot exceeds 8 MiB limit".into());
    }
    Ok(snapshot)
}

fn source_origin_from_url(url: &str) -> Option<String> {
    url::Url::parse(url).ok().map(|u| u.origin().ascii_serialization()).filter(|s| s != "null")
}

async fn handle_download_started(
    app: tauri::AppHandle,
    tab_label: String,
    url: String,
    destination: String,
    file_name: String,
    private: bool,
) {
    let id = uuid::Uuid::new_v4().to_string();
    let origin = source_origin_from_url(&url);
    if !private {
        let database = match local_store::connection(&app) {
            Ok(db) => db,
            Err(error) => {
                eprintln!("downloads: cannot open database: {error}");
                return;
            }
        };
        let record_input = downloads::RecordDownloadInput {
            id: id.clone(),
            url: url.clone(),
            file_name: file_name.clone(),
            target_path: Some(destination.clone()),
            mime_type: None,
            source_origin: origin.clone(),
            source_tab_label: Some(tab_label.clone()),
            private: false,
            danger_type: None,
        };
        if let Err(error) = downloads::insert_download(&database, record_input) {
            eprintln!("downloads: insert_download failed: {error}");
            return;
        }
    }
    let index = app.state::<DownloadIndex>();
    index.remember(&url, &id);
    let progress = DownloadProgress {
        version: EVENT_PAYLOAD_VERSION,
        kind: DOWNLOAD_EVENT_KIND_STARTED.into(),
        id,
        tab_label,
        url,
        file_name,
        target_path: Some(destination),
        mime_type: None,
        received_bytes: 0,
        total_bytes: None,
        progress_known: false,
        status: "downloading".into(),
        danger_type: "none".into(),
        error_message: None,
        private,
        source_origin: origin,
    };
    let _ = app.emit_to("main", "browser://download", progress);
}

async fn handle_download_finished(
    app: tauri::AppHandle,
    tab_label: String,
    url: String,
    final_path: Option<String>,
    success: bool,
    private: bool,
) {
    let index = app.state::<DownloadIndex>();
    let id = match index.get(&url) {
        Some(id) => id,
        None => return, // finished without a Requested; rare but harmless
    };
    index.forget(&url);
    let status = if success {
        downloads::DownloadStatus::Completed
    } else {
        downloads::DownloadStatus::Failed
    };
    if !private {
        let database = match local_store::connection(&app) {
            Ok(db) => db,
            Err(error) => {
                eprintln!("downloads: cannot open database: {error}");
                return;
            }
        };
        let progress_input = downloads::DownloadProgressInput {
            id: id.clone(),
            received_bytes: -1, // unknown on Finished events
            total_bytes: None,
            status,
            error_message: if success { None } else { Some("download failed".into()) },
        };
        if let Err(error) = downloads::update_progress(&database, progress_input) {
            eprintln!("downloads: update_progress failed: {error}");
        }
        if let Some(path) = final_path.as_ref() {
            // Patch the target_path in case WebView resolved a redirected filename.
            if let Err(error) = database.execute(
                "UPDATE downloads SET target_path=? WHERE id=?",
                rusqlite::params![path, id],
            ) {
                eprintln!("downloads: target_path update failed: {error}");
            }
        }
    }
    let origin = source_origin_from_url(&url);
    let progress = DownloadProgress {
        version: EVENT_PAYLOAD_VERSION,
        kind: if success { DOWNLOAD_EVENT_KIND_FINISHED.into() } else { DOWNLOAD_EVENT_KIND_FAILED.into() },
        id,
        tab_label,
        url,
        file_name: String::new(),
        target_path: final_path,
        mime_type: None,
        received_bytes: 0,
        total_bytes: None,
        progress_known: false,
        status: if success { "completed".into() } else { "failed".into() },
        danger_type: "none".into(),
        error_message: if success { None } else { Some("download failed".into()) },
        private,
        source_origin: origin,
    };
    let _ = app.emit_to("main", "browser://download", progress);
}

#[tauri::command]
async fn ai_chat(
    app: tauri::AppHandle,
    provider_id: String,
    request: ChatRequest,
) -> Result<ChatResponse, String> {
    let database = local_store::connection(&app)?;
    let (provider_type, base_url, model, timeout_seconds): (String, String, String, i64) = database
        .prepare("SELECT provider_type,base_url,model,timeout_seconds FROM ai_providers WHERE id=?")
        .map_err(|error| error.to_string())?
        .query_row(params![provider_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
        .map_err(|error| error.to_string())?;
    let timeout = Duration::from_secs(timeout_seconds.clamp(1, 600) as u64);
    let api_key = keyring::Entry::new(KEYRING_SERVICE, &provider_id)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|value| !value.is_empty());
    let provider: Box<dyn AiProvider> = match provider_type.as_str() {
        "openai-compatible" | "deepseek" | "qwen" | "kimi" | "minimax" => Box::new(providers::openai::OpenAICompatibleProvider {
            base_url,
            model,
            api_key: api_key.clone(),
            timeout,
        }),
        "ollama" => Box::new(providers::ollama::OllamaProvider { base_url, model, timeout }),
        other => return Err(format!("unknown provider type: {other}")),
    };
    if provider.type_id() == "openai-compatible" && api_key.is_none() {
        return Err("missing api key for openai-compatible provider".into());
    }
    let _ = ChatMessage { role: "system".into(), content: String::new() }; // keep types referenced
    provider.chat(request).await.map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderTestResult {
    ok: bool,
    endpoint: String,
    status: Option<u16>,
    models: Vec<String>,
    message: String,
}

#[tauri::command]
async fn ai_test_provider(
    app: tauri::AppHandle,
    provider_id: String,
) -> Result<ProviderTestResult, String> {
    let database = local_store::connection(&app)?;
    let (provider_type, base_url, timeout_seconds): (String, String, i64) = database
        .prepare("SELECT provider_type,base_url,timeout_seconds FROM ai_providers WHERE id=?")
        .map_err(|error| error.to_string())?
        .query_row(params![provider_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|error| error.to_string())?;
    let timeout = Duration::from_secs(timeout_seconds.clamp(1, 600) as u64);
    let client = reqwest::Client::builder().timeout(timeout).build().map_err(|error| error.to_string())?;
    let (endpoint, needs_auth) = match provider_type.as_str() {
        "openai-compatible" | "deepseek" | "qwen" | "kimi" | "minimax" => (format!("{}/models", base_url.trim_end_matches('/')), true),
        "ollama" => (format!("{}/api/tags", base_url.trim_end_matches('/')), false),
        other => return Err(format!("unknown provider type: {other}")),
    };
    let mut request_builder = client.get(&endpoint);
    if needs_auth {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &provider_id) {
            if let Ok(key) = entry.get_password() {
                if !key.is_empty() {
                    request_builder = request_builder.bearer_auth(key);
                } else {
                    return Ok(ProviderTestResult { ok: false, endpoint, status: None, models: vec![], message: "API Key 未配置".into() });
                }
            } else {
                return Ok(ProviderTestResult { ok: false, endpoint, status: None, models: vec![], message: "API Key 未配置".into() });
            }
        } else {
            return Ok(ProviderTestResult { ok: false, endpoint, status: None, models: vec![], message: "API Key 未配置".into() });
        }
    }
    let response = request_builder.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Ok(ProviderTestResult { ok: false, endpoint, status: Some(status.as_u16()), models: vec![], message: format!("HTTP {}", status.as_u16()) });
    }
    let models = match provider_type.as_str() {
        "openai-compatible" => serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v.get("data").and_then(|d| d.as_array().map(|arr| arr.clone())))
            .map(|arr| arr.into_iter().filter_map(|m| m.get("id").and_then(|v| v.as_str()).map(String::from)).collect())
            .unwrap_or_default(),
        "ollama" => serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v.get("models").and_then(|d| d.as_array().map(|arr| arr.clone())))
            .map(|arr| arr.into_iter().filter_map(|m| m.get("name").and_then(|v| v.as_str()).map(String::from)).collect())
            .unwrap_or_default(),
        _ => vec![],
    };
    Ok(ProviderTestResult { ok: true, endpoint, status: Some(status.as_u16()), models, message: format!("连接成功，发现 {} 个模型", match provider_type.as_str() { "openai-compatible" | "deepseek" | "qwen" | "kimi" | "minimax" => serde_json::from_str::<serde_json::Value>(&text).ok().and_then(|v| v.get("data").and_then(|d| d.as_array()).map(|a| a.len())).unwrap_or(0), "ollama" => serde_json::from_str::<serde_json::Value>(&text).ok().and_then(|v| v.get("models").and_then(|d| d.as_array()).map(|a| a.len())).unwrap_or(0), _ => 0 }) })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(NavStacks::default())
        .manage(DownloadIndex::default())
        .manage(downloads::DownloadManager::default())
        .manage(PermissionWaiters::default())
        .setup(|app| {
            // Set the runtime window icon explicitly as well as the bundled executable
            // icon. This keeps `tauri dev` and packaged Windows builds consistent.
            let icon = Image::from_bytes(include_bytes!("../icons/128x128.png"))?;
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(icon)?;
            }
            // Write the session lock so the next boot can detect a crash.
            if let Ok(database) = local_store::connection(app.handle()) {
                let now = chrono::Utc::now().timestamp();
                if let Err(error) = session_lock::write_lock(&database, now) {
                    eprintln!("session_lock: write_lock failed: {error}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Tauri 2 surfaces WindowEvent::CloseRequested for every window;
            // we treat any of them as a graceful exit and clear the lock.
            // SIGKILL / power loss will leave the lock row in place.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Ok(database) = local_store::connection(window.app_handle()) {
                    let now = chrono::Utc::now().timestamp();
                    if let Err(error) = session_lock::clear_lock(&database, now) {
                        eprintln!("session_lock: clear_lock failed: {error}");
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            validate_navigation,
            browser_create,
            browser_set_ad_blocking,
            browser_set_muted,
            browser_navigate,
            browser_reload,
            browser_stop,
            browser_edit_action,
            browser_clear_page_data,
            browser_find,
            browser_zoom,
            browser_print,
            browser_history,
            browser_state,
            browser_restore_scroll,
            browser_toolbar_menu,
            browser_toolbar_panel,
            browser_snapshot,
            browser_capabilities,
            browser_permission_request,
            browser_permission_respond,
            downloads::download_list,
            downloads::download_get,
            downloads::download_remove_record,
            downloads::download_open_file,
            downloads::download_show_in_folder,
            downloads::download_start_reqwest,
            downloads::download_pause,
            downloads::download_cancel,
            downloads::download_retry,
            local_store::local_list_documents,
            local_store::local_save_document,
            local_store::local_get_document,
            local_store::local_delete_document,
            local_store::local_find_document_by_url,
            local_store::local_toggle_starred,
            local_store::local_update_document,
            local_store::local_update_tags,
            local_store::local_update_auto_tags,
            local_store::local_archive_document,
            local_store::local_create_collection,
            local_store::local_list_collections,
            local_store::local_delete_collection,
            local_store::local_add_to_collection,
            local_store::local_remove_from_collection,
            local_store::local_list_collections_for_document,
            local_store::local_enqueue_task,
            local_store::local_claim_pending_task,
            local_store::local_complete_task,
            local_store::local_fail_task,
            local_store::local_recover_stale_tasks,
            local_store::local_retry_task,
            local_store::local_list_recent_tasks,
            local_store::local_save_ai_provider,
            local_store::local_get_ai_provider,
            local_store::local_list_ai_providers,
            local_store::local_delete_ai_provider,
            ai_chat,
            ai_test_provider,
            local_store::local_get_session,
            local_store::local_set_session,
            local_store::local_list_history,
            local_store::local_record_reading_activity,
            local_store::local_list_reading_activity,
            local_store::local_add_history,
            local_store::local_clear_history,
            local_store::local_get_browser_workspace,
            local_store::local_save_browser_workspace,
            local_store::local_list_workspaces,
            local_store::local_get_workspace,
            local_store::local_save_workspace,
            local_store::local_delete_workspace,
            local_store::local_list_closed_tabs,
            local_store::local_save_closed_tab,
            local_store::local_delete_closed_tab,
            local_store::local_clear_closed_tabs,
            local_store::local_list_site_permissions,
            local_store::local_replace_site_permissions,
            local_store::local_export_backup,
            local_store::local_import_backup,
            local_store::local_migration_status,
            browser_permission_request,
            browser_permission_respond,
            session_lock::browser_session_status,
            session_lock::browser_session_drop,
            certificate_guard::browser_certificate_respond,
            bookmarks::bookmark_list,
            bookmarks::bookmark_add,
            bookmarks::bookmark_get,
            bookmarks::bookmark_remove,
            bookmarks::bookmark_update,
            bookmarks::bookmark_move,
            process_memory::browser_process_memory,
            webview_compat::shell_open,
            webview_compat::toggle_fullscreen,
            webview_compat::pick_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI Knowledge Browser");
}

#[tauri::command]
async fn browser_permission_request(
    app: tauri::AppHandle,
    request_id: String,
    origin: String,
    kind: String,
    timeout_ms: Option<u64>,
) -> Result<bool, String> {
    if request_id.is_empty() || origin.is_empty() || kind.is_empty() {
        return Err("request_id, origin and kind are required".into());
    }
    let waiters = app.state::<PermissionWaiters>();
    let receiver = waiters.register(request_id.clone());
    let _ = app.emit_to(
        "main",
        "browser://permission-request",
        PermissionRequestPayload {
            version: 1,
            request_id: request_id.clone(),
            origin: origin.clone(),
            kind: kind.clone(),
        },
    );
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(15_000));
    let verdict = match tokio::time::timeout(timeout, receiver).await {
        Ok(Ok(allow)) => allow,
        _ => {
            // Drop the waiter so a late response is ignored instead of writing
            // into a stale oneshot.
            if let Ok(mut guard) = waiters.pending.lock() {
                guard.remove(&request_id);
            }
            false
        }
    };
    Ok(verdict)
}

#[tauri::command]
fn browser_permission_respond(
    app: tauri::AppHandle,
    request_id: String,
    allow: bool,
) -> Result<bool, String> {
    let waiters = app.state::<PermissionWaiters>();
    Ok(waiters.resolve(&request_id, allow))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_navigation_rejects_privileged_protocols() {
        assert!(external_url("file:///C:/Windows/System32").is_err());
        assert!(external_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn browser_labels_cannot_target_the_trusted_main_webview() {
        assert!(validate_browser_label("browser-tab-123").is_ok());
        assert!(validate_browser_label("main").is_err());
        assert!(validate_browser_label("browser-").is_err());
        assert!(validate_browser_label("browser-../main").is_err());
    }

    #[test]
    fn nav_stack_observes_page_clicks_and_spa_routes() {
        let mut stack = NavStack::default();
        stack.observe("https://example.com/".into());
        stack.observe("https://example.com/docs".into());
        stack.observe("https://example.com/docs/intro".into());
        assert!(stack.can_go_back());
        assert!(!stack.can_go_forward());
        assert_eq!(stack.index, 2);
    }

    #[test]
    fn nav_stack_recognizes_native_back_and_forward_changes() {
        let mut stack = NavStack::default();
        stack.push("https://example.com/a".into());
        stack.push("https://example.com/b".into());
        stack.push("https://example.com/c".into());
        stack.observe("https://example.com/b".into());
        assert_eq!(stack.index, 1);
        assert!(stack.can_go_forward());
        stack.observe("https://example.com/c".into());
        assert_eq!(stack.index, 2);
    }

    #[test]
    fn capability_flags_match_matrix_expectations() {
        let caps = browser_capabilities();
        // Reflect docs/browser-native-capability-matrix.md — change in lockstep.
        assert!(caps.download_progress_bytes, "Tauri 2 DownloadEvent::Progress is observable");
        assert!(!caps.download_pause_resume, "no pause/resume API in stable");
        assert!(caps.download_cancel, "Requested handler returning false cancels");
        assert!(!caps.native_permission_events, "PermissionRequested not in Tauri 2 stable");
        assert!(!caps.native_context_menu, "wry has no context menu integration");
        assert!(!caps.clear_site_data, "WebView2 profile API not in wry");
        assert!(!caps.certificate_error_interceptor, "needs ICoreWebView2_5 + webview2-com");
        assert!(caps.webview_backend.is_some(), "backend label must be set on every target");
        assert!(caps.tauri_runtime_version.is_some(), "tauri runtime version must be set");
    }

    #[test]
    fn event_payload_version_is_v2() {
        assert_eq!(EVENT_PAYLOAD_VERSION, 2);
    }

    #[test]
    fn audio_monitor_reports_state_and_applies_muting() {
        let script = audio_monitor_script("browser-tab-123");
        assert!(script.contains("browser://audio-state"));
        assert!(script.contains("setMuted"));
        assert!(script.contains("audio,video"));
        assert!(script.contains("browser-tab-123"));
    }
}
