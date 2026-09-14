pub mod browser;
pub mod plugins;

use tauri::Manager;

#[tauri::command]
fn validate_navigation(url: String) -> Result<String, String> {
    browser::normalize_navigation(&url).map_err(|error| error.to_string())
}

fn external_url(input: &str) -> Result<url::Url, String> {
    let normalized = browser::normalize_navigation(input).map_err(|error| error.to_string())?;
    let url = url::Url::parse(&normalized).map_err(|error| error.to_string())?;
    match url.scheme() { "http" | "https" => Ok(url), _ => Err("only http and https navigation is allowed".into()) }
}

#[tauri::command]
async fn browser_navigate(app: tauri::AppHandle, label: String, url: String) -> Result<String, String> {
    let url = external_url(&url)?;
    app.get_webview(&label).ok_or_else(|| "browser tab webview not found".to_string())?.navigate(url.clone()).map_err(|error| error.to_string())?;
    Ok(url.to_string())
}

#[tauri::command]
async fn browser_reload(app: tauri::AppHandle, label: String) -> Result<(), String> {
    app.get_webview(&label).ok_or_else(|| "browser tab webview not found".to_string())?.reload().map_err(|error| error.to_string())
}

#[tauri::command]
async fn browser_history(app: tauri::AppHandle, label: String, delta: i32) -> Result<(), String> {
    if !(-1..=1).contains(&delta) || delta == 0 { return Err("history delta must be -1 or 1".into()) }
    app.get_webview(&label).ok_or_else(|| "browser tab webview not found".to_string())?.eval(format!("history.go({delta})")).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![validate_navigation, browser_navigate, browser_reload, browser_history])
        .run(tauri::generate_context!())
        .expect("error while running AI Knowledge Browser");
}
