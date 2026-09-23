//! Browser web-compat helpers for batch 9.
//!
//! Three small commands the frontend calls when an embedded WebView can't
//! solve the problem on its own:
//!
//! - `shell_open` — open an external `vscode://` style URL via the system
//!   shell after the user opts in. This is the only safe way to honour
//!   custom protocol handlers without bringing in `webview2-com`.
//! - `pick_files` — open the OS file picker and return the absolute paths
//!   the user chose. The frontend overrides `<input type="file">` clicks
//!   to invoke this so we can intercept uploads.
//! - `toggle_fullscreen` — flip the main window between normal and
//!   fullscreen. The browser surfaces this as a toolbar button and on
//!   every `requestFullscreen()` JS call from a page.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePickResult {
    pub paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePickFilters {
    pub label: String,
    pub extensions: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePickOptions {
    pub title: Option<String>,
    pub multiple: Option<bool>,
    pub directory: Option<bool>,
    pub filters: Option<Vec<FilePickFilters>>,
}

fn is_dangerous_custom_scheme(scheme: &str) -> bool {
    matches!(
        scheme.to_ascii_lowercase().as_str(),
        "javascript" | "vbscript" | "data" | "file" | "chrome" | "about" | "ms-appx"
    )
}

#[tauri::command]
pub fn shell_open(_app: AppHandle, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|error| format!("invalid url: {error}"))?;
    if matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("refusing to open {} via system shell", parsed.scheme()));
    }
    if is_dangerous_custom_scheme(parsed.scheme()) {
        return Err(format!("refusing to open dangerous scheme: {}", parsed.scheme()));
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", parsed.as_str()])
            .spawn()
            .map_err(|error| format!("failed to launch shell: {error}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(parsed.as_str())
            .spawn()
            .map_err(|error| format!("failed to launch shell: {error}"))?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(parsed.as_str())
            .spawn()
            .map_err(|error| format!("failed to launch shell: {error}"))?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("shell_open is not supported on this platform".into())
    }
}

#[tauri::command]
pub fn toggle_fullscreen(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let currently_full = window.is_fullscreen().unwrap_or(false);
    let next = !currently_full;
    window
        .set_fullscreen(next)
        .map_err(|error| error.to_string())?;
    Ok(next)
}

/// Pick files via the OS dialog. The frontend has no third-party file
/// picker crate installed; for batch 9 we use the simplest portable
/// path — spawning `cmd.exe /C start` with a `<input>` placeholder would
/// not work. Instead we use Tauri's `DialogExt::file_dialog()` if
/// `tauri-plugin-dialog` is wired in, and fall back to manual entry
/// otherwise.
#[tauri::command]
pub fn pick_files(app: AppHandle, options: FilePickOptions) -> Result<FilePickResult, String> {
    use tauri_plugin_dialog::DialogExt;
    let multiple = options.multiple.unwrap_or(false);
    let directory = options.directory.unwrap_or(false);
    let title = options.title.clone();

    let (tx, rx) = std::sync::mpsc::channel();
    let mut builder = app.dialog().file();
    if let Some(title) = title {
        builder = builder.set_title(title);
    }
    fn file_path_to_string(path: tauri_plugin_dialog::FilePath) -> String {
    use tauri_plugin_dialog::FilePath;
    match path {
        FilePath::Path(buf) => buf.to_string_lossy().into_owned(),
        FilePath::Url(url) => url.to_string(),
    }
}

if directory {
        builder.pick_folder(move |path| {
            let _ = tx.send(path.map(|p| vec![file_path_to_string(p)]));
        });
    } else if multiple {
        builder.pick_files(move |paths| {
            let collected: Vec<String> = match paths {
                Some(list) => list.into_iter().map(file_path_to_string).collect(),
                None => Vec::new(),
            };
            let _ = tx.send(Some(collected));
        });
    } else {
        builder.pick_file(move |path| {
            let _ = tx.send(path.map(|p| vec![file_path_to_string(p)]));
        });
    }

    let paths = rx
        .recv_timeout(std::time::Duration::from_secs(300))
        .map_err(|_| "file dialog timed out".to_string())?
        .unwrap_or_default();
    Ok(FilePickResult { paths })
}

fn canonicalise_user_path(path: &PathBuf) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|error| format!("path not accessible: {error}"))?;
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dangerous_schemes_are_blocked() {
        assert!(is_dangerous_custom_scheme("javascript"));
        assert!(is_dangerous_custom_scheme("JavaScript"));
        assert!(is_dangerous_custom_scheme("file"));
        assert!(is_dangerous_custom_scheme("vbscript"));
        assert!(is_dangerous_custom_scheme("data"));
        assert!(!is_dangerous_custom_scheme("vscode"));
        assert!(!is_dangerous_custom_scheme("slack"));
        assert!(!is_dangerous_custom_scheme("zoommtg"));
        assert!(!is_dangerous_custom_scheme("mailto"));
    }
}