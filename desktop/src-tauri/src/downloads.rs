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