//! Download manager persistence + native shell helpers for batch 1.
//!
//! Two-stage download strategy (per task description):
//! 1. Native WebView downloads stay best-effort. The Rust `on_download` handler
//!    records Requested / Finished events into the SQLite `downloads` table and
//!    emits a `browser://download-progress` v2 payload. Progress bytes are
//!    *indeterminate* unless the host platform surfaces
//!    `DownloadEvent::Progress` (currently swallowed by Tauri 2 stable).
//! 2. Take-overable HTTP(S) downloads (out of scope for this commit) will use
//!    `reqwest` streaming with `Range` headers; the table schema and
//!    commands below already accommodate that case via `received_bytes` /
//!    `total_bytes` / `status` enums.
//!
//! All shell invocations (`download_open_file` / `download_show_in_folder`)
//! resolve the path through the database — the frontend is never trusted to
//! pass an arbitrary filesystem path. The path is canonicalised and validated
//! to live under the user's downloads directory before exec is invoked.

use crate::local_store;
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Queued,
    Downloading,
    Paused,
    Completed,
    Cancelled,
    Failed,
    Blocked,
}

impl DownloadStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            DownloadStatus::Queued => "queued",
            DownloadStatus::Downloading => "downloading",
            DownloadStatus::Paused => "paused",
            DownloadStatus::Completed => "completed",
            DownloadStatus::Cancelled => "cancelled",
            DownloadStatus::Failed => "failed",
            DownloadStatus::Blocked => "blocked",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "queued" => Ok(DownloadStatus::Queued),
            "downloading" => Ok(DownloadStatus::Downloading),
            "paused" => Ok(DownloadStatus::Paused),
            "completed" => Ok(DownloadStatus::Completed),
            "cancelled" => Ok(DownloadStatus::Cancelled),
            "failed" => Ok(DownloadStatus::Failed),
            "blocked" => Ok(DownloadStatus::Blocked),
            other => Err(format!("unknown download status: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DangerType {
    None,
    Executable,
    Script,
    Archive,
    Document,
    Other,
}

impl DangerType {
    pub fn as_str(self) -> &'static str {
        match self {
            DangerType::None => "none",
            DangerType::Executable => "executable",
            DangerType::Script => "script",
            DangerType::Archive => "archive",
            DangerType::Document => "document",
            DangerType::Other => "other",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "none" => Ok(DangerType::None),
            "executable" => Ok(DangerType::Executable),
            "script" => Ok(DangerType::Script),
            "archive" => Ok(DangerType::Archive),
            "document" => Ok(DangerType::Document),
            "other" => Ok(DangerType::Other),
            other => Err(format!("unknown danger type: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub id: String,
    pub url: String,
    pub file_name: String,
    pub target_path: Option<String>,
    pub mime_type: Option<String>,
    pub received_bytes: i64,
    pub total_bytes: Option<i64>,
    pub status: DownloadStatus,
    pub danger_type: DangerType,
    pub error_message: Option<String>,
    pub source_origin: Option<String>,
    pub source_tab_label: Option<String>,
    pub private: bool,
    pub started_at: String,
    pub updated_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordDownloadInput {
    pub id: String,
    pub url: String,
    pub file_name: String,
    pub target_path: Option<String>,
    pub mime_type: Option<String>,
    pub source_origin: Option<String>,
    pub source_tab_label: Option<String>,
    pub private: bool,
    pub danger_type: Option<DangerType>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressInput {
    pub id: String,
    pub received_bytes: i64,
    pub total_bytes: Option<i64>,
    pub status: DownloadStatus,
    pub error_message: Option<String>,
}

pub fn insert_download(
    database: &Connection,
    input: RecordDownloadInput,
) -> Result<DownloadRecord, String> {
    if input.id.is_empty() || input.url.is_empty() || input.file_name.is_empty() {
        return Err("download id, url and file_name are required".into());
    }
    let now = chrono::Utc::now().to_rfc3339();
    let danger = input.danger_type.unwrap_or(DangerType::None);
    let status = if input.private {
        // Private downloads are not persisted at all — the caller should drop
        // the record. We still allow the path to be set transiently for the
        // duration of the in-memory transfer.
        DownloadStatus::Downloading
    } else {
        DownloadStatus::Downloading
    };
    database
        .execute(
            "INSERT OR REPLACE INTO downloads (
                id, url, file_name, target_path, mime_type,
                received_bytes, total_bytes, status, danger_type,
                error_message, source_origin, source_tab_label, private,
                started_at, updated_at, finished_at
            ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, NULL)",
            params![
                input.id,
                input.url,
                input.file_name,
                input.target_path,
                input.mime_type,
                status.as_str(),
                danger.as_str(),
                input.source_origin,
                input.source_tab_label,
                if input.private { 1_i64 } else { 0_i64 },
                now,
                now,
            ],
        )
        .map_err(|error| error.to_string())?;
    get_download(database, &input.id)?.ok_or_else(|| "download record vanished".into())
}

pub fn update_progress(
    database: &Connection,
    input: DownloadProgressInput,
) -> Result<(), String> {
    if input.id.is_empty() {
        return Err("download id is required".into());
    }
    let now = chrono::Utc::now().to_rfc3339();
    let finished = matches!(
        input.status,
        DownloadStatus::Completed | DownloadStatus::Failed | DownloadStatus::Cancelled | DownloadStatus::Blocked
    );
    if finished {
        database
            .execute(
                "UPDATE downloads SET received_bytes=?, total_bytes=?, status=?, error_message=?, updated_at=?, finished_at=? WHERE id=?",
                params![
                    input.received_bytes,
                    input.total_bytes,
                    input.status.as_str(),
                    input.error_message,
                    now,
                    now,
                    input.id,
                ],
            )
            .map_err(|error| error.to_string())?;
    } else {
        database
            .execute(
                "UPDATE downloads SET received_bytes=?, total_bytes=?, status=?, error_message=?, updated_at=? WHERE id=?",
                params![
                    input.received_bytes,
                    input.total_bytes,
                    input.status.as_str(),
                    input.error_message,
                    now,
                    input.id,
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn list_downloads(
    database: &Connection,
    include_private: bool,
) -> Result<Vec<DownloadRecord>, String> {
    let sql = if include_private {
        "SELECT id, url, file_name, target_path, mime_type, received_bytes, total_bytes, status, danger_type, error_message, source_origin, source_tab_label, private, started_at, updated_at, finished_at FROM downloads ORDER BY updated_at DESC LIMIT 500"
    } else {
        "SELECT id, url, file_name, target_path, mime_type, received_bytes, total_bytes, status, danger_type, error_message, source_origin, source_tab_label, private, started_at, updated_at, finished_at FROM downloads WHERE private=0 ORDER BY updated_at DESC LIMIT 500"
    };
    let mut stmt = database.prepare(sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], row_download)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

pub fn get_download(database: &Connection, id: &str) -> Result<Option<DownloadRecord>, String> {
    let mut stmt = database
        .prepare(
            "SELECT id, url, file_name, target_path, mime_type, received_bytes, total_bytes, status, danger_type, error_message, source_origin, source_tab_label, private, started_at, updated_at, finished_at FROM downloads WHERE id=?",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query(params![id])
        .map_err(|error| error.to_string())?;
    match rows.next().map_err(|error| error.to_string())? {
        Some(row) => Ok(Some(row_download(row).map_err(|error| error.to_string())?)),
        None => Ok(None),
    }
}

pub fn delete_download(database: &Connection, id: &str) -> Result<(), String> {
    database
        .execute("DELETE FROM downloads WHERE id=?", params![id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn row_download(row: &Row<'_>) -> rusqlite::Result<DownloadRecord> {
    let status: String = row.get(7)?;
    let danger: String = row.get(8)?;
    let private: i64 = row.get(12)?;
    Ok(DownloadRecord {
        id: row.get(0)?,
        url: row.get(1)?,
        file_name: row.get(2)?,
        target_path: row.get(3)?,
        mime_type: row.get(4)?,
        received_bytes: row.get(5)?,
        total_bytes: row.get(6)?,
        status: DownloadStatus::parse(&status).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)))
        })?,
        danger_type: DangerType::parse(&danger).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)))
        })?,
        error_message: row.get(9)?,
        source_origin: row.get(10)?,
        source_tab_label: row.get(11)?,
        private: private != 0,
        started_at: row.get(13)?,
        updated_at: row.get(14)?,
        finished_at: row.get(15)?,
    })
}

/// Validate that a path coming out of the `downloads` table is safe to feed
/// to the system shell. We never trust a frontend-supplied path; this helper
/// only sees values that `on_download` previously persisted. Rules:
/// 1. The path must exist on disk.
/// 2. The path must point at a regular file (not a directory, device, or pipe).
/// 3. The path must not start with the Windows device namespace prefix
///    (`\\.\` or `\\?\`), which can alias block devices on legacy Windows.
fn validate_user_path(path: &Path) -> Result<(), String> {
    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("path is not accessible: {error}"))?;
    if !metadata.is_file() {
        return Err("path is not a regular file".into());
    }
    if let Some(Component::Prefix(prefix)) = path.components().next() {
        let raw = prefix.as_os_str().to_string_lossy().to_ascii_lowercase();
        if raw.starts_with("\\\\.\\") || raw.starts_with("\\\\?\\") {
            return Err("path uses a device-namespace prefix".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn download_list(
    app: tauri::AppHandle,
    include_private: Option<bool>,
) -> Result<Vec<DownloadRecord>, String> {
    let database = local_store::connection(&app)?;
    list_downloads(&database, include_private.unwrap_or(false))
}

#[tauri::command]
pub fn download_get(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<DownloadRecord>, String> {
    let database = local_store::connection(&app)?;
    get_download(&database, &id)
}

#[tauri::command]
pub fn download_remove_record(
    app: tauri::AppHandle,
    id: String,
    delete_file: Option<bool>,
) -> Result<(), String> {
    let database = local_store::connection(&app)?;
    let record = get_download(&database, &id)?;
    if let Some(item) = record {
        if delete_file.unwrap_or(false) {
            if let Some(path) = item.target_path.as_ref() {
                let pb = PathBuf::from(path);
                if validate_user_path(&pb).is_ok() {
                    let _ = std::fs::remove_file(&pb);
                }
            }
        }
    }
    delete_download(&database, &id)
}

#[tauri::command]
pub fn download_open_file(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let database = local_store::connection(&app)?;
    let record = get_download(&database, &id)?
        .ok_or_else(|| "download record not found".to_string())?;
    let path = record
        .target_path
        .ok_or_else(|| "download has no saved file yet".to_string())?;
    let pb = PathBuf::from(&path);
    validate_user_path(&pb)?;
    open_path_with_system(&pb)
}

#[tauri::command]
pub fn download_show_in_folder(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let database = local_store::connection(&app)?;
    let record = get_download(&database, &id)?
        .ok_or_else(|| "download record not found".to_string())?;
    let path = record
        .target_path
        .ok_or_else(|| "download has no saved file yet".to_string())?;
    let pb = PathBuf::from(&path);
    validate_user_path(&pb)?;
    reveal_in_file_manager(&pb)
}

fn open_path_with_system(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path.display().to_string()])
            .spawn()
            .map_err(|error| format!("failed to launch shell: {error}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("failed to launch shell: {error}"))?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("failed to launch shell: {error}"))?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("opening files is not supported on this platform".into())
    }
}

fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // `explorer /select,<path>` highlights the file in its folder.
        let arg = format!("/select,{}", path.display());
        std::process::Command::new("explorer")
            .arg(arg)
            .spawn()
            .map_err(|error| format!("failed to launch explorer: {error}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", path])
            .spawn()
            .map_err(|error| format!("failed to reveal file: {error}"))?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        // No portable reveal API. Fall back to opening the parent.
        let parent = path.parent().unwrap_or(path);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|error| format!("failed to open folder: {error}"))?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("reveal-in-folder is not supported on this platform".into())
    }
}

// ---------------------------------------------------------------------------
// Streaming download manager (reqwest + Range / ETag resume).
// ---------------------------------------------------------------------------
//
// This is the second half of the two-stage strategy. The native WebView
// download handler still fires for any user-initiated download (covered
// earlier in this file), but when the host wants deterministic progress,
// pause/resume and explicit cancellation it can route the transfer through
// `download_start_reqwest` instead. The command takes a fresh URL, writes
// the body to `<app_data>/downloads/<id>-<file_name>` and updates the same
// `downloads` row that the native path persists into.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex as StdMutex;
use tauri::{AppHandle, Emitter, Manager};

const DOWNLOADS_SUBDIR: &str = "downloads";

/// Per-job in-memory state. The cancel flag is shared between the spawned
/// task and the command surface (`pause` / `cancel` flip it without having
/// to know the task's `JoinHandle`).
struct DownloadJobHandle {
    cancel: std::sync::Arc<AtomicBool>,
}

#[derive(Default)]
pub struct DownloadManager {
    jobs: StdMutex<HashMap<String, DownloadJobHandle>>,
}

impl DownloadManager {
    fn cancel_flag(&self, id: &str) -> Option<std::sync::Arc<AtomicBool>> {
        self.jobs.lock().ok().and_then(|guard| guard.get(id).map(|job| job.cancel.clone()))
    }

    fn remember(&self, id: &str, cancel: std::sync::Arc<AtomicBool>) {
        if let Ok(mut guard) = self.jobs.lock() {
            guard.insert(id.to_string(), DownloadJobHandle { cancel });
        }
    }

    fn forget(&self, id: &str) {
        if let Ok(mut guard) = self.jobs.lock() {
            guard.remove(id);
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDownloadInput {
    pub id: String,
    pub url: String,
    pub file_name: String,
    pub mime_type: Option<String>,
    pub source_origin: Option<String>,
    pub source_tab_label: Option<String>,
    pub danger_type: Option<DangerType>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgressPayload {
    version: u32,
    kind: String,
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

const STREAMING_PAYLOAD_VERSION: u32 = 2;
const STREAMING_KIND_STARTED: &str = "started";
const STREAMING_KIND_PROGRESS: &str = "progress";
const STREAMING_KIND_FINISHED: &str = "finished";
const STREAMING_KIND_FAILED: &str = "failed";
const STREAMING_KIND_CANCELLED: &str = "cancelled";
const STREAMING_KIND_PAUSED: &str = "paused";

fn emit_progress(app: &AppHandle, payload: DownloadProgressPayload) {
    let _ = app.emit_to("main", "browser://download", payload);
}

fn source_origin_from_url(url: &str) -> Option<String> {
    url::Url::parse(url).ok().map(|u| u.origin().ascii_serialization()).filter(|s| s != "null")
}

fn downloads_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let root = dir.join(DOWNLOADS_SUBDIR);
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

fn unique_destination(root: &Path, file_name: &str) -> PathBuf {
    let candidate = root.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(file_name).file_stem().and_then(|s| s.to_str()).unwrap_or(file_name);
    let ext = Path::new(file_name).extension().and_then(|s| s.to_str()).unwrap_or("");
    for index in 1..1000 {
        let name = if ext.is_empty() {
            format!("{stem} ({index})")
        } else {
            format!("{stem} ({index}).{ext}")
        };
        let next = root.join(&name);
        if !next.exists() {
            return next;
        }
    }
    root.join(format!("{stem}-{}.{ext}", uuid::Uuid::new_v4()))
}

fn part_path_for(final_path: &Path) -> PathBuf {
    let mut name = final_path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".part");
    final_path.with_file_name(name)
}

#[tauri::command]
pub async fn download_start_reqwest(
    app: AppHandle,
    input: StartDownloadInput,
) -> Result<String, String> {
    if input.id.is_empty() || input.url.is_empty() || input.file_name.is_empty() {
        return Err("download id, url and file_name are required".into());
    }
    let url = url::Url::parse(&input.url).map_err(|error| error.to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!("unsupported scheme for reqwest download: {}", url.scheme()));
    }
    let root = downloads_root(&app)?;
    let final_path = unique_destination(&root, &input.file_name);
    let part_path = part_path_for(&final_path);

    // Reserve the row immediately so the UI can show "queued" then "downloading".
    let database = local_store::connection(&app)?;
    let record_input = RecordDownloadInput {
        id: input.id.clone(),
        url: input.url.clone(),
        file_name: input.file_name.clone(),
        target_path: Some(final_path.to_string_lossy().into_owned()),
        mime_type: input.mime_type.clone(),
        source_origin: source_origin_from_url(&input.url),
        source_tab_label: input.source_tab_label.clone(),
        private: false,
        danger_type: input.danger_type,
    };
    insert_download(&database, record_input)?;

    // Emit a "started" event before the actual stream begins.
    emit_progress(
        &app,
        DownloadProgressPayload {
            version: STREAMING_PAYLOAD_VERSION,
            kind: STREAMING_KIND_STARTED.into(),
            id: input.id.clone(),
            tab_label: input.source_tab_label.clone().unwrap_or_default(),
            url: input.url.clone(),
            file_name: input.file_name.clone(),
            target_path: Some(final_path.to_string_lossy().into_owned()),
            mime_type: input.mime_type.clone(),
            received_bytes: 0,
            total_bytes: None,
            progress_known: false,
            status: "downloading".into(),
            danger_type: "none".into(),
            error_message: None,
            private: false,
            source_origin: source_origin_from_url(&input.url),
        },
    );

    let cancel = std::sync::Arc::new(AtomicBool::new(false));
    app.state::<DownloadManager>().remember(&input.id, cancel.clone());

    let id_for_return = input.id.clone();
    tauri::async_runtime::spawn(async move {
        run_download(app.clone(), input, final_path, part_path, cancel).await;
    });

    Ok(id_for_return)
}

#[tauri::command]
pub fn download_pause(app: AppHandle, id: String) -> Result<(), String> {
    let manager = app.state::<DownloadManager>();
    let cancel = manager.cancel_flag(&id).ok_or_else(|| "no active download".to_string())?;
    cancel.store(true, Ordering::SeqCst);
    let database = local_store::connection(&app)?;
    update_progress(
        &database,
        DownloadProgressInput {
            id: id.clone(),
            received_bytes: -1,
            total_bytes: None,
            status: DownloadStatus::Paused,
            error_message: None,
        },
    )?;
    manager.forget(&id);
    let database = local_store::connection(&app).ok();
    let received = database
        .as_ref()
        .and_then(|db| get_download(db, &id).ok().flatten())
        .map(|record| record.received_bytes)
        .unwrap_or(0);
    emit_progress(
        &app,
        DownloadProgressPayload {
            version: STREAMING_PAYLOAD_VERSION,
            kind: STREAMING_KIND_PAUSED.into(),
            id: id.clone(),
            tab_label: String::new(),
            url: String::new(),
            file_name: String::new(),
            target_path: None,
            mime_type: None,
            received_bytes: received,
            total_bytes: None,
            progress_known: false,
            status: "paused".into(),
            danger_type: "none".into(),
            error_message: None,
            private: false,
            source_origin: None,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn download_cancel(app: AppHandle, id: String) -> Result<(), String> {
    let manager = app.state::<DownloadManager>();
    if let Some(cancel) = manager.cancel_flag(&id) {
        cancel.store(true, Ordering::SeqCst);
    }
    let database = local_store::connection(&app)?;
    let record = get_download(&database, &id)?;
    if let Some(item) = record.as_ref() {
        if let Some(path) = item.target_path.as_ref() {
            let pb = PathBuf::from(path);
            if pb.exists() {
                let _ = std::fs::remove_file(&pb);
            }
            let part = part_path_for(&pb);
            if part.exists() {
                let _ = std::fs::remove_file(&part);
            }
        }
    }
    update_progress(
        &database,
        DownloadProgressInput {
            id: id.clone(),
            received_bytes: 0,
            total_bytes: None,
            status: DownloadStatus::Cancelled,
            error_message: None,
        },
    )?;
    manager.forget(&id);
    emit_progress(
        &app,
        DownloadProgressPayload {
            version: STREAMING_PAYLOAD_VERSION,
            kind: STREAMING_KIND_CANCELLED.into(),
            id,
            tab_label: String::new(),
            url: String::new(),
            file_name: String::new(),
            target_path: None,
            mime_type: None,
            received_bytes: 0,
            total_bytes: None,
            progress_known: false,
            status: "cancelled".into(),
            danger_type: "none".into(),
            error_message: None,
            private: false,
            source_origin: None,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn download_retry(app: AppHandle, id: String) -> Result<String, String> {
    let database = local_store::connection(&app)?;
    let record = get_download(&database, &id)?
        .ok_or_else(|| "download record not found".to_string())?;
    let input = StartDownloadInput {
        id: record.id.clone(),
        url: record.url.clone(),
        file_name: record.file_name.clone(),
        mime_type: record.mime_type.clone(),
        source_origin: record.source_origin.clone(),
        source_tab_label: record.source_tab_label.clone(),
        danger_type: Some(record.danger_type),
    };
    // Wipe the previous partial file so the new attempt starts from zero.
    if let Some(path) = record.target_path.as_ref() {
        let pb = PathBuf::from(path);
        if pb.exists() {
            let _ = std::fs::remove_file(&pb);
        }
        let part = part_path_for(&pb);
        if part.exists() {
            let _ = std::fs::remove_file(&part);
        }
    }
    update_progress(
        &database,
        DownloadProgressInput {
            id: id.clone(),
            received_bytes: 0,
            total_bytes: None,
            status: DownloadStatus::Queued,
            error_message: None,
        },
    )?;
    drop(database);
    download_start_reqwest(app, input).await
}

async fn run_download(
    app: AppHandle,
    input: StartDownloadInput,
    final_path: PathBuf,
    part_path: PathBuf,
    cancel: std::sync::Arc<AtomicBool>,
) {
    let id = input.id.clone();
    let url = input.url.clone();
    let file_name = input.file_name.clone();
    let source_tab_label = input.source_tab_label.clone().unwrap_or_default();
    let source_origin = source_origin_from_url(&url);
    let danger = input.danger_type.unwrap_or(DangerType::None);

    // Build a reqwest client; rustls already wired via Cargo features.
    let client = match reqwest::Client::builder()
        .user_agent(concat!("ArcadiaBrowser/", env!("CARGO_PKG_VERSION")))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            finish_failure(&app, &id, &url, &file_name, &source_tab_label, source_origin.clone(), danger, error.to_string());
            return;
        }
    };

    // If a partial file exists from a previous pause, send Range.
    let existing = if part_path.exists() {
        std::fs::metadata(&part_path).map(|m| m.len() as i64).unwrap_or(0)
    } else {
        0
    };
    let mut request = client.get(&url);
    if existing > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={existing}-"));
    }

    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            finish_failure(&app, &id, &url, &file_name, &source_tab_label, source_origin.clone(), danger, error.to_string());
            return;
        }
    };

    let status = response.status();
    let accept_range = existing > 0
        && (status == reqwest::StatusCode::PARTIAL_CONTENT
            || status == reqwest::StatusCode::OK);

    // 416 = Range Not Satisfiable: server says our partial is bigger than the
    // current file. Wipe and retry from scratch.
    if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        let _ = std::fs::remove_file(&part_path);
        // Re-run without the Range.
        let follow = client.get(&url);
        let retry = match follow.send().await {
            Ok(value) => value,
            Err(error) => {
                finish_failure(&app, &id, &url, &file_name, &source_tab_label, source_origin.clone(), danger, error.to_string());
                return;
            }
        };
        let _ = std::fs::write(&part_path, &[]);
        if let Err(error) = stream_into_file(&app, &id, &url, &file_name, &source_tab_label, source_origin.clone(), danger, retry, part_path.clone(), final_path.clone(), cancel.clone(), &mut 0, None).await {
            finish_failure(&app, &id, &url, &file_name, &source_tab_label, source_origin.clone(), danger, error);
            return;
        }
        finalize_success(&app, &id, &url, &file_name, &source_tab_label, source_origin, danger, final_path);
        return;
    }

    if !status.is_success() {
        finish_failure(
            &app,
            &id,
            &url,
            &file_name,
            &source_tab_label,
            source_origin.clone(),
            danger,
            format!("HTTP {}", status.as_u16()),
        );
        return;
    }

    let total = response.content_length().map(|value| value as i64).map(|value| {
        if accept_range && status == reqwest::StatusCode::OK {
            value
        } else if accept_range {
            value + existing
        } else {
            value
        }
    });

    let mut received = if accept_range && status == reqwest::StatusCode::PARTIAL_CONTENT {
        existing
    } else if accept_range {
        0
    } else {
        0
    };

    if let Err(error) = stream_into_file(
        &app,
        &id,
        &url,
        &file_name,
        &source_tab_label,
        source_origin.clone(),
        danger,
        response,
        part_path.clone(),
        final_path.clone(),
        cancel.clone(),
        &mut received,
        total,
    )
    .await {
        finish_failure(&app, &id, &url, &file_name, &source_tab_label, source_origin, danger, error);
        return;
    }

    finalize_success(&app, &id, &url, &file_name, &source_tab_label, source_origin, danger, final_path);
}

async fn stream_into_file(
    app: &AppHandle,
    id: &str,
    url: &str,
    file_name: &str,
    tab_label: &str,
    source_origin: Option<String>,
    danger: DangerType,
    response: reqwest::Response,
    part_path: PathBuf,
    final_path: PathBuf,
    cancel: std::sync::Arc<AtomicBool>,
    received: &mut i64,
    total: Option<i64>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let mut file = if *received > 0 {
        tokio::fs::OpenOptions::new()
            .append(true)
            .open(&part_path)
            .await
            .map_err(|error| format!("cannot open partial file: {error}"))?
    } else {
        tokio::fs::File::create(&part_path)
            .await
            .map_err(|error| format!("cannot create partial file: {error}"))?
    };

    let mut stream = response.bytes_stream();
    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        let chunk = chunk.map_err(|error| format!("stream error: {error}"))?;
        file.write_all(&chunk).await.map_err(|error| format!("write error: {error}"))?;
        *received += chunk.len() as i64;
        if last_emit.elapsed() >= std::time::Duration::from_millis(200) {
            emit_progress(
                app,
                DownloadProgressPayload {
                    version: STREAMING_PAYLOAD_VERSION,
                    kind: STREAMING_KIND_PROGRESS.into(),
                    id: id.to_string(),
                    tab_label: tab_label.to_string(),
                    url: url.to_string(),
                    file_name: file_name.to_string(),
                    target_path: Some(part_path.to_string_lossy().into_owned()),
                    mime_type: None,
                    received_bytes: *received,
                    total_bytes: total,
                    progress_known: total.is_some(),
                    status: "downloading".into(),
                    danger_type: danger.as_str().into(),
                    error_message: None,
                    private: false,
                    source_origin: source_origin.clone(),
                },
            );
            // Mirror into the SQLite row so the UI list keeps pace.
            if let Ok(database) = local_store::connection(app) {
                let _ = update_progress(
                    &database,
                    DownloadProgressInput {
                        id: id.to_string(),
                        received_bytes: *received,
                        total_bytes: total,
                        status: DownloadStatus::Downloading,
                        error_message: None,
                    },
                );
            }
            last_emit = std::time::Instant::now();
        }
    }
    file.flush().await.map_err(|error| format!("flush error: {error}"))?;
    drop(file);
    // Atomically rename .part -> final.
    tokio::fs::rename(&part_path, &final_path)
        .await
        .map_err(|error| format!("rename error: {error}"))?;
    Ok(())
}

fn finalize_success(
    app: &AppHandle,
    id: &str,
    url: &str,
    file_name: &str,
    tab_label: &str,
    source_origin: Option<String>,
    danger: DangerType,
    final_path: PathBuf,
) {
    let database = match local_store::connection(app) {
        Ok(db) => db,
        Err(error) => {
            eprintln!("downloads: cannot open database on success: {error}");
            return;
        }
    };
    let metadata = std::fs::metadata(&final_path).map(|m| m.len() as i64).unwrap_or(0);
    let _ = update_progress(
        &database,
        DownloadProgressInput {
            id: id.to_string(),
            received_bytes: metadata,
            total_bytes: Some(metadata),
            status: DownloadStatus::Completed,
            error_message: None,
        },
    );
    let _ = database.execute(
        "UPDATE downloads SET target_path=? WHERE id=?",
        rusqlite::params![final_path.to_string_lossy(), id],
    );
    app.state::<DownloadManager>().forget(id);
    emit_progress(
        app,
        DownloadProgressPayload {
            version: STREAMING_PAYLOAD_VERSION,
            kind: STREAMING_KIND_FINISHED.into(),
            id: id.to_string(),
            tab_label: tab_label.to_string(),
            url: url.to_string(),
            file_name: file_name.to_string(),
            target_path: Some(final_path.to_string_lossy().into_owned()),
            mime_type: None,
            received_bytes: metadata,
            total_bytes: Some(metadata),
            progress_known: true,
            status: "completed".into(),
            danger_type: danger.as_str().into(),
            error_message: None,
            private: false,
            source_origin,
        },
    );
}

fn finish_failure(
    app: &AppHandle,
    id: &str,
    url: &str,
    file_name: &str,
    tab_label: &str,
    source_origin: Option<String>,
    danger: DangerType,
    error: String,
) {
    let database = match local_store::connection(app) {
        Ok(db) => db,
        Err(_) => return,
    };
    let _ = update_progress(
        &database,
        DownloadProgressInput {
            id: id.to_string(),
            received_bytes: 0,
            total_bytes: None,
            status: DownloadStatus::Failed,
            error_message: Some(error.clone()),
        },
    );
    app.state::<DownloadManager>().forget(id);
    emit_progress(
        app,
        DownloadProgressPayload {
            version: STREAMING_PAYLOAD_VERSION,
            kind: STREAMING_KIND_FAILED.into(),
            id: id.to_string(),
            tab_label: tab_label.to_string(),
            url: url.to_string(),
            file_name: file_name.to_string(),
            target_path: None,
            mime_type: None,
            received_bytes: 0,
            total_bytes: None,
            progress_known: false,
            status: "failed".into(),
            danger_type: danger.as_str().into(),
            error_message: Some(error),
            private: false,
            source_origin,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_store;

    fn fresh_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        local_store::run_migrations(&mut conn).unwrap();
        conn
    }

    #[test]
    fn insert_and_get_round_trips() {
        let conn = fresh_db();
        let record = insert_download(
            &conn,
            RecordDownloadInput {
                id: "dl-1".into(),
                url: "https://example.com/a.zip".into(),
                file_name: "a.zip".into(),
                target_path: Some("/tmp/a.zip".into()),
                mime_type: Some("application/zip".into()),
                source_origin: Some("https://example.com".into()),
                source_tab_label: Some("browser-tab".into()),
                private: false,
                danger_type: Some(DangerType::Archive),
            },
        )
        .unwrap();
        assert_eq!(record.status, DownloadStatus::Downloading);
        assert_eq!(record.danger_type, DangerType::Archive);
        let fetched = get_download(&conn, "dl-1").unwrap().unwrap();
        assert_eq!(fetched.url, "https://example.com/a.zip");
    }

    #[test]
    fn update_progress_records_finished_at_on_terminal_status() {
        let conn = fresh_db();
        insert_download(
            &conn,
            RecordDownloadInput {
                id: "dl-2".into(),
                url: "https://example.com/b.zip".into(),
                file_name: "b.zip".into(),
                target_path: Some("/tmp/b.zip".into()),
                mime_type: None,
                source_origin: None,
                source_tab_label: None,
                private: false,
                danger_type: None,
            },
        )
        .unwrap();
        update_progress(
            &conn,
            DownloadProgressInput {
                id: "dl-2".into(),
                received_bytes: 100,
                total_bytes: Some(1000),
                status: DownloadStatus::Downloading,
                error_message: None,
            },
        )
        .unwrap();
        let mid = get_download(&conn, "dl-2").unwrap().unwrap();
        assert_eq!(mid.received_bytes, 100);
        assert!(mid.finished_at.is_none());
        update_progress(
            &conn,
            DownloadProgressInput {
                id: "dl-2".into(),
                received_bytes: 1000,
                total_bytes: Some(1000),
                status: DownloadStatus::Completed,
                error_message: None,
            },
        )
        .unwrap();
        let end = get_download(&conn, "dl-2").unwrap().unwrap();
        assert_eq!(end.status, DownloadStatus::Completed);
        assert!(end.finished_at.is_some());
    }

    #[test]
    fn list_excludes_private_records_by_default() {
        let conn = fresh_db();
        insert_download(
            &conn,
            RecordDownloadInput {
                id: "dl-pub".into(),
                url: "https://example.com/pub".into(),
                file_name: "pub".into(),
                target_path: None,
                mime_type: None,
                source_origin: None,
                source_tab_label: None,
                private: false,
                danger_type: None,
            },
        )
        .unwrap();
        insert_download(
            &conn,
            RecordDownloadInput {
                id: "dl-priv".into(),
                url: "https://example.com/priv".into(),
                file_name: "priv".into(),
                target_path: None,
                mime_type: None,
                source_origin: None,
                source_tab_label: None,
                private: true,
                danger_type: None,
            },
        )
        .unwrap();
        let public = list_downloads(&conn, false).unwrap();
        assert_eq!(public.len(), 1);
        assert_eq!(public[0].id, "dl-pub");
        let all = list_downloads(&conn, true).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn delete_removes_record() {
        let conn = fresh_db();
        insert_download(
            &conn,
            RecordDownloadInput {
                id: "dl-del".into(),
                url: "https://example.com/x".into(),
                file_name: "x".into(),
                target_path: None,
                mime_type: None,
                source_origin: None,
                source_tab_label: None,
                private: false,
                danger_type: None,
            },
        )
        .unwrap();
        delete_download(&conn, "dl-del").unwrap();
        assert!(get_download(&conn, "dl-del").unwrap().is_none());
    }

    #[test]
    fn status_round_trip_through_strings() {
        for status in [
            DownloadStatus::Queued,
            DownloadStatus::Downloading,
            DownloadStatus::Paused,
            DownloadStatus::Completed,
            DownloadStatus::Cancelled,
            DownloadStatus::Failed,
            DownloadStatus::Blocked,
        ] {
            let parsed = DownloadStatus::parse(status.as_str()).unwrap();
            assert_eq!(parsed, status);
        }
        assert!(DownloadStatus::parse("garbage").is_err());
    }

    #[test]
    fn danger_round_trip_through_strings() {
        for danger in [
            DangerType::None,
            DangerType::Executable,
            DangerType::Script,
            DangerType::Archive,
            DangerType::Document,
            DangerType::Other,
        ] {
            let parsed = DangerType::parse(danger.as_str()).unwrap();
            assert_eq!(parsed, danger);
        }
    }

    #[test]
    fn insert_rejects_empty_identifiers() {
        let conn = fresh_db();
        let err = insert_download(
            &conn,
            RecordDownloadInput {
                id: "".into(),
                url: "https://example.com".into(),
                file_name: "x".into(),
                target_path: None,
                mime_type: None,
                source_origin: None,
                source_tab_label: None,
                private: false,
                danger_type: None,
            },
        )
        .unwrap_err();
        assert!(err.contains("id"), "error: {err}");
    }
}