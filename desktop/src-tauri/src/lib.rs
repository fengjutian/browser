pub mod browser;
pub mod local_store;
pub mod plugins;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::image::Image;
use tauri::{Emitter, Manager};

#[derive(Debug, Deserialize)]
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
    opener_label: String,
    url: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserState {
    url: String,
    title: String,
    favicon: Option<String>,
    loading: bool,
    can_go_back: bool,
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

#[tauri::command]
async fn browser_create(
    app: tauri::AppHandle,
    label: String,
    url: String,
    bounds: BrowserBounds,
) -> Result<(), String> {
    if app.get_webview(&label).is_some() {
        return Ok(());
    }
    let url = external_url(&url)?;
    let nav_url = url.to_string();
    let opener_label = label.clone();
    let event_app = app.clone();
    let builder = tauri::webview::WebviewBuilder::new(&label, tauri::WebviewUrl::External(url))
        .on_new_window(move |url, _features| {
            if matches!(url.scheme(), "http" | "https") {
                let _ = event_app.emit_to(
                    "main",
                    "browser://new-tab",
                    NewTabRequest {
                        opener_label: opener_label.clone(),
                        url: url.to_string(),
                    },
                );
            }
            tauri::webview::NewWindowResponse::Deny
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
    let navs = app.state::<NavStacks>();
    let mut guard = navs.stacks.lock().map_err(|_| "nav stack poisoned".to_string())?;
    let stack = guard.entry(label).or_default();
    stack.push(nav_url);
    Ok(())
}

#[tauri::command]
async fn browser_navigate(
    app: tauri::AppHandle,
    label: String,
    url: String,
) -> Result<String, String> {
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
    app.get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?
        .reload()
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn browser_stop(app: tauri::AppHandle, label: String) -> Result<(), String> {
    app.get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?
        .eval("window.stop()")
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn browser_history(app: tauri::AppHandle, label: String, delta: i32) -> Result<(), String> {
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
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "browser tab webview not found".to_string())?;
    let mut state: BrowserState = eval_json(
        webview,
        "({url:location.href,title:document.title,favicon:(document.querySelector('link[rel~=icon]')?.href??null),loading:document.readyState!=='complete'})",
    )
    .await?;
    let navs = app.state::<NavStacks>();
    let guard = navs.stacks.lock().map_err(|_| "nav stack poisoned".to_string())?;
    if let Some(stack) = guard.get(&label) {
        state.can_go_back = stack.can_go_back();
        state.can_go_forward = stack.can_go_forward();
    } else {
        state.can_go_back = false;
        state.can_go_forward = false;
    }
    Ok(state)
}

#[tauri::command]
async fn browser_snapshot(app: tauri::AppHandle, label: String) -> Result<PageSnapshot, String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(NavStacks::default())
        .setup(|app| {
            // Set the runtime window icon explicitly as well as the bundled executable
            // icon. This keeps `tauri dev` and packaged Windows builds consistent.
            let icon = Image::from_bytes(include_bytes!("../icons/128x128.png"))?;
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(icon)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            validate_navigation,
            browser_create,
            browser_navigate,
            browser_reload,
            browser_stop,
            browser_history,
            browser_state,
            browser_snapshot,
            local_store::local_list_documents,
            local_store::local_save_document,
            local_store::local_get_document,
            local_store::local_delete_document,
            local_store::local_toggle_starred,
            local_store::local_get_session,
            local_store::local_set_session,
            local_store::local_export_backup,
            local_store::local_import_backup,
            local_store::local_migration_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI Knowledge Browser");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_navigation_rejects_privileged_protocols() {
        assert!(external_url("file:///C:/Windows/System32").is_err());
        assert!(external_url("javascript:alert(1)").is_err());
    }
}
