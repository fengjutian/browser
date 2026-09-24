use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// Ordered, append-only schema migrations. Each entry's `sql` runs in a single
/// transaction and is recorded in `schema_version` once it commits. New
/// migrations must use the next unused version number and never edit an older
/// entry.
const MIGRATIONS: &[(i64, &str)] = &[
    (
        1,
        "CREATE TABLE local_documents (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            source TEXT,
            author TEXT,
            summary TEXT,
            markdown TEXT,
            word_count INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL
        );
        CREATE INDEX idx_local_documents_created_at ON local_documents(created_at DESC);",
    ),
    (
        2,
        "ALTER TABLE local_documents ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX idx_local_documents_starred ON local_documents(starred DESC, created_at DESC);",
    ),
    (
        3,
        "CREATE TABLE local_session (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );",
    ),
    (
        4,
        "CREATE TABLE collections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE collection_documents (
            collection_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            added_at TEXT NOT NULL,
            PRIMARY KEY (collection_id, document_id),
            FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
            FOREIGN KEY (document_id) REFERENCES local_documents(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_collection_documents_document ON collection_documents(document_id);",
    ),
    (
        5,
        "CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            document_id TEXT,
            payload TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'PENDING',
            attempts INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 5,
            available_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            last_error TEXT
        );
        CREATE INDEX idx_tasks_status_available ON tasks(status, available_at);
        CREATE INDEX idx_tasks_document ON tasks(document_id);",
    ),
    (
        6,
        "CREATE TABLE ai_providers (
            id TEXT PRIMARY KEY,
            provider_type TEXT NOT NULL,
            base_url TEXT NOT NULL,
            model TEXT NOT NULL,
            embedding_model TEXT,
            timeout_seconds INTEGER NOT NULL DEFAULT 60,
            has_api_key INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    ),
    (
        7,
        "ALTER TABLE local_documents ADD COLUMN auto_tags TEXT NOT NULL DEFAULT '[]';",
    ),
    (
        8,
        "CREATE TABLE downloads (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            file_name TEXT NOT NULL,
            target_path TEXT,
            mime_type TEXT,
            received_bytes INTEGER NOT NULL DEFAULT 0,
            total_bytes INTEGER,
            status TEXT NOT NULL,
            danger_type TEXT NOT NULL DEFAULT 'none',
            error_message TEXT,
            source_origin TEXT,
            source_tab_label TEXT,
            private INTEGER NOT NULL DEFAULT 0,
            started_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            finished_at TEXT
        );
        CREATE INDEX idx_downloads_status_updated ON downloads(status, updated_at DESC);
        CREATE INDEX idx_downloads_private ON downloads(private);",
    ),
    (
        9,
        "CREATE TABLE session_locks (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            started_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            clean_exit_at INTEGER
        );",
    ),
    (
        10,
        "CREATE TABLE browser_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            title TEXT NOT NULL,
            visited_at INTEGER NOT NULL
        );
        CREATE INDEX idx_browser_history_visited_at ON browser_history(visited_at DESC);",
    ),
    (
        11,
        "CREATE TABLE browser_sessions (
            id TEXT PRIMARY KEY,
            active_tab_id TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE browser_tabs (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(session_id) REFERENCES browser_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_browser_tabs_session_position ON browser_tabs(session_id, position);
        CREATE TABLE closed_tabs (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            title TEXT NOT NULL,
            favicon TEXT,
            closed_at INTEGER NOT NULL
        );
        CREATE INDEX idx_closed_tabs_closed_at ON closed_tabs(closed_at DESC);
        CREATE TABLE site_permissions (
            origin TEXT NOT NULL,
            permission_kind TEXT NOT NULL,
            decision TEXT NOT NULL CHECK(decision IN ('allow','deny','ask')),
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(origin, permission_kind)
        );",
    ),
    (
        12,
        "CREATE TABLE bookmarks (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            title TEXT NOT NULL,
            favicon TEXT,
            folder TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX idx_bookmarks_url_unique ON bookmarks(url);
        CREATE INDEX idx_bookmarks_folder_position ON bookmarks(folder, position);",
    ),
    (
        13,
        "CREATE TABLE workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            tab_count INTEGER NOT NULL DEFAULT 0,
            payload TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_workspaces_updated_at ON workspaces(updated_at DESC);",
    ),
    (
        14,
        "CREATE TABLE reading_activity (
            url TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            first_visited_at INTEGER NOT NULL,
            last_visited_at INTEGER NOT NULL,
            active_seconds INTEGER NOT NULL DEFAULT 0,
            max_scroll_depth REAL NOT NULL DEFAULT 0,
            visit_count INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX idx_reading_activity_last_visited ON reading_activity(last_visited_at DESC);",
    ),
    (
        15,
        "ALTER TABLE reading_activity ADD COLUMN excerpt TEXT;
         ALTER TABLE reading_activity ADD COLUMN markdown TEXT;
         ALTER TABLE reading_activity ADD COLUMN captured_at INTEGER;",
    ),
    (
        16,
        "CREATE TABLE saved_credentials (
            id TEXT PRIMARY KEY,
            origin TEXT NOT NULL,
            username TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(origin, username)
        );
        CREATE INDEX idx_saved_credentials_origin ON saved_credentials(origin);",
    ),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDocument {
    id: String,
    title: String,
    url: String,
    source: Option<String>,
    author: Option<String>,
    summary: Option<String>,
    markdown: Option<String>,
    word_count: i64,
    status: String,
    tags: Vec<String>,
    #[serde(default)]
    auto_tags: Vec<String>,
    created_at: String,
    starred: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMigrationStatus {
    version: i64,
    pending: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalHistoryEntry {
    url: String,
    title: String,
    visited_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalReadingActivity {
    url: String,
    title: String,
    first_visited_at: i64,
    last_visited_at: i64,
    active_seconds: i64,
    max_scroll_depth: f64,
    visit_count: i64,
    excerpt: Option<String>,
    markdown: Option<String>,
    captured_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingSnapshotStats { count: i64, bytes: i64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBrowserWorkspace {
    tabs: Vec<serde_json::Value>,
    active_tab_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalWorkspaceSummary {
    id: String,
    name: String,
    description: String,
    tab_count: i64,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalWorkspace {
    id: String,
    name: String,
    description: String,
    payload: serde_json::Value,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalWorkspaceSaveInput {
    id: Option<String>,
    name: String,
    description: String,
    payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalClosedTab {
    id: String,
    url: String,
    title: String,
    favicon: Option<String>,
    closed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSitePermission {
    origin: String,
    permission_kind: String,
    decision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedCredential {
    id: String,
    origin: String,
    username: String,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutofillCredential {
    username: String,
    password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCollection {
    id: String,
    name: String,
    description: Option<String>,
    created_at: String,
    updated_at: String,
    document_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTask {
    id: String,
    kind: String,
    document_id: Option<String>,
    payload: String,
    status: String,
    attempts: i64,
    max_attempts: i64,
    available_at: String,
    started_at: Option<String>,
    finished_at: Option<String>,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAIProvider {
    id: String,
    provider_type: String,
    base_url: String,
    model: String,
    embedding_model: Option<String>,
    timeout_seconds: i64,
    has_api_key: bool,
    created_at: String,
    updated_at: String,
}

pub fn connection(app: &tauri::AppHandle) -> Result<Connection, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let mut database =
        Connection::open(directory.join("knowledge.db")).map_err(|error| error.to_string())?;
    run_migrations(&mut database)?;
    Ok(database)
}

pub(crate) fn run_migrations(database: &mut Connection) -> Result<(), String> {
    database
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            )",
        )
        .map_err(|error| error.to_string())?;

    let mut applied: Vec<i64> = database
        .prepare("SELECT version FROM schema_version")
        .map_err(|error| error.to_string())?
        .query_map([], |row| row.get(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    applied.sort_unstable();

    if !applied.iter().any(|v| *v == 1) && table_exists(database, "local_documents")? {
        record_version(database, 1)?;
        applied.push(1);
        applied.sort_unstable();
    }

    for (version, sql) in MIGRATIONS {
        if applied.binary_search(version).is_ok() {
            continue;
        }
        let transaction = database.transaction().map_err(|error| error.to_string())?;
        transaction
            .execute_batch(sql)
            .map_err(|error| error.to_string())?;
        if *version == 10 {
            migrate_legacy_history(&transaction)?;
        }
        if *version == 11 {
            migrate_legacy_browser_state(&transaction)?;
        }
        transaction
            .execute(
                "INSERT INTO schema_version(version, applied_at) VALUES(?, ?)",
                params![version, unix_seconds()],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        applied.push(*version);
        applied.sort_unstable();
    }
    Ok(())
}

fn migrate_legacy_history(database: &Connection) -> Result<(), String> {
    let legacy = database.query_row(
        "SELECT value FROM local_session WHERE key='browser.history'",
        [],
        |row| row.get::<_, String>(0),
    );
    if let Ok(raw) = legacy {
        if let Ok(entries) = serde_json::from_str::<Vec<LocalHistoryEntry>>(&raw) {
            for entry in entries {
                if validate_history_entry(&entry).is_ok() {
                    database
                        .execute(
                            "INSERT INTO browser_history(url,title,visited_at) VALUES(?,?,?)",
                            params![entry.url, entry.title, entry.visited_at],
                        )
                        .map_err(|error| error.to_string())?;
                }
            }
        }
        database
            .execute("DELETE FROM local_session WHERE key='browser.history'", [])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn validate_history_entry(entry: &LocalHistoryEntry) -> Result<(), String> {
    if entry.url.len() > 8192 || entry.title.len() > 2048 || entry.visited_at <= 0 {
        return Err("invalid browser history entry".into());
    }
    let parsed = url::Url::parse(&entry.url).map_err(|error| format!("invalid history url: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("history url must use http or https".into());
    }
    Ok(())
}

fn migrate_legacy_browser_state(database: &Connection) -> Result<(), String> {
    if let Ok(raw) = database.query_row("SELECT value FROM local_session WHERE key='browser.tabs'", [], |row| row.get::<_, String>(0)) {
        if let Ok(workspace) = serde_json::from_str::<LocalBrowserWorkspace>(&raw) {
            database.execute("INSERT OR REPLACE INTO browser_sessions(id,active_tab_id,updated_at) VALUES('main',?,?)", params![workspace.active_tab_id, unix_seconds()]).map_err(|error| error.to_string())?;
            for (position, tab) in workspace.tabs.into_iter().enumerate() {
                if let Some(id) = tab.get("id").and_then(|value| value.as_str()) {
                    database.execute("INSERT OR REPLACE INTO browser_tabs(id,session_id,position,payload,updated_at) VALUES(?,'main',?,?,?)", params![id, position as i64, tab.to_string(), unix_seconds()]).map_err(|error| error.to_string())?;
                }
            }
        }
    }
    if let Ok(raw) = database.query_row("SELECT value FROM local_session WHERE key='browser.closed'", [], |row| row.get::<_, String>(0)) {
        if let Ok(tabs) = serde_json::from_str::<Vec<LocalClosedTab>>(&raw) {
            for tab in tabs.into_iter().take(20) {
                database.execute("INSERT OR REPLACE INTO closed_tabs(id,url,title,favicon,closed_at) VALUES(?,?,?,?,?)", params![tab.id, tab.url, tab.title, tab.favicon, tab.closed_at]).map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

fn table_exists(database: &Connection, name: &str) -> Result<bool, String> {
    let count: i64 = database
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
            params![name],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(count > 0)
}

fn record_version(database: &Connection, version: i64) -> Result<(), String> {
    database
        .execute(
            "INSERT INTO schema_version(version, applied_at) VALUES(?, ?)",
            params![version, unix_seconds()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn row_document(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalDocument> {
    let tags: String = row.get(9)?;
    let auto_tags: String = row.get(11)?;
    let starred: i64 = row.get(12)?;
    Ok(LocalDocument {
        id: row.get(0)?,
        title: row.get(1)?,
        url: row.get(2)?,
        source: row.get(3)?,
        author: row.get(4)?,
        summary: row.get(5)?,
        markdown: row.get(6)?,
        word_count: row.get(7)?,
        status: row.get(8)?,
        tags: serde_json::from_str(&tags).unwrap_or_default(),
        auto_tags: serde_json::from_str(&auto_tags).unwrap_or_default(),
        created_at: row.get(10)?,
        starred: starred != 0,
    })
}

#[tauri::command]
pub fn local_list_documents(
    app: tauri::AppHandle,
    query: String,
) -> Result<Vec<LocalDocument>, String> {
    let database = connection(&app)?;
    let pattern = format!("%{}%", query.trim());
    let mut statement = database.prepare("SELECT id,title,url,source,author,summary,markdown,word_count,status,tags,auto_tags,created_at,starred FROM local_documents WHERE ?1 = '%%' OR title LIKE ?1 OR markdown LIKE ?1 OR summary LIKE ?1 OR tags LIKE ?1 ORDER BY starred DESC, created_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![pattern], row_document)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_save_document(
    app: tauri::AppHandle,
    document: LocalDocument,
) -> Result<LocalDocument, String> {
    let database = connection(&app)?;
    let tags = serde_json::to_string(&document.tags).map_err(|error| error.to_string())?;
    let auto_tags = serde_json::to_string(&document.auto_tags).unwrap_or_else(|_| "[]".to_string());
    database.execute("INSERT OR REPLACE INTO local_documents(id,title,url,source,author,summary,markdown,word_count,status,tags,auto_tags,created_at,starred) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", params![document.id, document.title, document.url, document.source, document.author, document.summary, document.markdown, document.word_count, document.status, tags, auto_tags, document.created_at, document.starred as i64])
        .map_err(|error| error.to_string())?;
    Ok(document)
}

#[tauri::command]
pub fn local_get_document(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<LocalDocument>, String> {
    let database = connection(&app)?;
    let mut statement = database.prepare("SELECT id,title,url,source,author,summary,markdown,word_count,status,tags,auto_tags,created_at,starred FROM local_documents WHERE id=?")
        .map_err(|error| error.to_string())?;
    match statement.query_row(params![id], row_document) {
        Ok(document) => Ok(Some(document)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn local_delete_document(app: tauri::AppHandle, id: String) -> Result<(), String> {
    connection(&app)?
        .execute("DELETE FROM local_documents WHERE id=?", params![id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn local_update_document(
    app: tauri::AppHandle,
    id: String,
    title: Option<String>,
    summary: Option<String>,
    tags: Option<Vec<String>>,
    starred: Option<bool>,
    status: Option<String>,
) -> Result<LocalDocument, String> {
    let database = connection(&app)?;
    let tags_json = match tags {
        Some(values) => Some(serde_json::to_string(&values).map_err(|error| error.to_string())?),
        None => None,
    };
    let updated = database
        .execute(
            "UPDATE local_documents SET
                title = COALESCE(?2, title),
                summary = COALESCE(?3, summary),
                tags = COALESCE(?4, tags),
                starred = COALESCE(?5, starred),
                status = COALESCE(?6, status)
             WHERE id = ?1",
            params![
                id,
                title,
                summary,
                tags_json,
                starred.map(|value| value as i64),
                status,
            ],
        )
        .map_err(|error| error.to_string())?;
    if updated == 0 {
        return Err(format!("document not found: {id}"));
    }
    let mut statement = database
        .prepare("SELECT id,title,url,source,author,summary,markdown,word_count,status,tags,auto_tags,created_at,starred FROM local_documents WHERE id=?1")
        .map_err(|error| error.to_string())?;
    statement
        .query_row(params![id], row_document)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_update_tags(
    app: tauri::AppHandle,
    id: String,
    tags: Vec<String>,
) -> Result<(), String> {
    let database = connection(&app)?;
    let tags_json = serde_json::to_string(&tags).map_err(|error| error.to_string())?;
    let updated = database
        .execute("UPDATE local_documents SET tags=? WHERE id=?", params![tags_json, id])
        .map_err(|error| error.to_string())?;
    if updated == 0 {
        return Err(format!("document not found: {id}"));
    }
    Ok(())
}

#[tauri::command]
pub fn local_update_auto_tags(
    app: tauri::AppHandle,
    id: String,
    auto_tags: Vec<String>,
) -> Result<(), String> {
    let database = connection(&app)?;
    let tags_json = serde_json::to_string(&auto_tags).map_err(|error| error.to_string())?;
    let updated = database
        .execute("UPDATE local_documents SET auto_tags=? WHERE id=?", params![tags_json, id])
        .map_err(|error| error.to_string())?;
    if updated == 0 {
        return Err(format!("document not found: {id}"));
    }
    Ok(())
}

#[tauri::command]
pub fn local_archive_document(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let database = connection(&app)?;
    let updated = database
        .execute(
            "UPDATE local_documents SET status='ARCHIVED' WHERE id=?",
            params![id],
        )
        .map_err(|error| error.to_string())?;
    if updated == 0 {
        return Err(format!("document not found: {id}"));
    }
    Ok(())
}

#[tauri::command]
pub fn local_create_collection(
    app: tauri::AppHandle,
    name: String,
    description: Option<String>,
) -> Result<LocalCollection, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("collection name must not be empty".into());
    }
    let database = connection(&app)?;
    let id = format!("col-{}", uuid::Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    database
        .execute(
            "INSERT INTO collections(id,name,description,created_at,updated_at) VALUES(?,?,?,?,?)",
            params![id, trimmed, description, now, now],
        )
        .map_err(|error| error.to_string())?;
    Ok(LocalCollection { id, name: trimmed.to_string(), description, created_at: now.clone(), updated_at: now, document_count: 0 })
}

#[tauri::command]
pub fn local_list_collections(app: tauri::AppHandle) -> Result<Vec<LocalCollection>, String> {
    let database = connection(&app)?;
    let mut statement = database
        .prepare("SELECT c.id,c.name,c.description,c.created_at,c.updated_at,COUNT(cd.document_id) AS document_count FROM collections c LEFT JOIN collection_documents cd ON cd.collection_id=c.id GROUP BY c.id ORDER BY c.updated_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(LocalCollection {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                document_count: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_delete_collection(app: tauri::AppHandle, id: String) -> Result<(), String> {
    connection(&app)?
        .execute("DELETE FROM collections WHERE id=?", params![id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn local_add_to_collection(
    app: tauri::AppHandle,
    collection_id: String,
    document_id: String,
) -> Result<(), String> {
    let database = connection(&app)?;
    let now = chrono::Utc::now().to_rfc3339();
    database
        .execute(
            "INSERT OR REPLACE INTO collection_documents(collection_id,document_id,added_at) VALUES(?,?,?)",
            params![collection_id, document_id, now],
        )
        .map_err(|error| error.to_string())?;
    database
        .execute(
            "UPDATE collections SET updated_at=? WHERE id=?",
            params![now, collection_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn local_remove_from_collection(
    app: tauri::AppHandle,
    collection_id: String,
    document_id: String,
) -> Result<(), String> {
    connection(&app)?
        .execute(
            "DELETE FROM collection_documents WHERE collection_id=? AND document_id=?",
            params![collection_id, document_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn local_list_collections_for_document(
    app: tauri::AppHandle,
    document_id: String,
) -> Result<Vec<LocalCollection>, String> {
    let database = connection(&app)?;
    let mut statement = database
        .prepare("SELECT c.id,c.name,c.description,c.created_at,c.updated_at,COUNT(cd2.document_id) AS document_count FROM collections c JOIN collection_documents cd ON cd.collection_id=c.id LEFT JOIN collection_documents cd2 ON cd2.collection_id=c.id WHERE cd.document_id=?1 GROUP BY c.id ORDER BY c.updated_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![document_id], |row| {
            Ok(LocalCollection {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                document_count: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

fn row_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalTask> {
    Ok(LocalTask {
        id: row.get(0)?,
        kind: row.get(1)?,
        document_id: row.get(2)?,
        payload: row.get(3)?,
        status: row.get(4)?,
        attempts: row.get(5)?,
        max_attempts: row.get(6)?,
        available_at: row.get(7)?,
        started_at: row.get(8)?,
        finished_at: row.get(9)?,
        last_error: row.get(10)?,
    })
}

#[tauri::command]
pub fn local_enqueue_task(
    app: tauri::AppHandle,
    kind: String,
    document_id: Option<String>,
    payload: Option<String>,
    max_attempts: Option<i64>,
) -> Result<LocalTask, String> {
    let database = connection(&app)?;
    let id = format!("task-{}", uuid::Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    let payload = payload.unwrap_or_else(|| "{}".to_string());
    let max_attempts = max_attempts.unwrap_or(5);
    database
        .execute(
            "INSERT INTO tasks(id,kind,document_id,payload,status,attempts,max_attempts,available_at) VALUES(?,?,?,?,?,0,?,?)",
            params![id, kind, document_id, payload, "PENDING", max_attempts, now],
        )
        .map_err(|error| error.to_string())?;
    Ok(LocalTask {
        id,
        kind,
        document_id,
        payload,
        status: "PENDING".to_string(),
        attempts: 0,
        max_attempts,
        available_at: now,
        started_at: None,
        finished_at: None,
        last_error: None,
    })
}

#[tauri::command]
pub fn local_claim_pending_task(app: tauri::AppHandle) -> Result<Option<LocalTask>, String> {
    let database = connection(&app)?;
    let now = chrono::Utc::now().to_rfc3339();
    let mut statement = database
        .prepare(
            "UPDATE tasks SET status='PROCESSING', started_at=?1, attempts=attempts+1
             WHERE id = (SELECT id FROM tasks WHERE status='PENDING' AND available_at<=?1 ORDER BY available_at LIMIT 1)
             RETURNING id,kind,document_id,payload,status,attempts,max_attempts,available_at,started_at,finished_at,last_error",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = statement.query(params![now]).map_err(|error| error.to_string())?;
    match rows.next().map_err(|error| error.to_string())? {
        Some(row) => Ok(Some(row_task(&row).map_err(|error| error.to_string())?)),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn local_complete_task(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let database = connection(&app)?;
    let now = chrono::Utc::now().to_rfc3339();
    database
        .execute("UPDATE tasks SET status='COMPLETED', finished_at=? WHERE id=?", params![now, id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn local_fail_task(
    app: tauri::AppHandle,
    id: String,
    error: String,
    backoff_seconds: i64,
) -> Result<(), String> {
    let database = connection(&app)?;
    let now = chrono::Utc::now();
    let next_available = (now + chrono::Duration::seconds(backoff_seconds)).to_rfc3339();
    let updated = database
        .execute(
            "UPDATE tasks SET
                status = CASE WHEN attempts >= max_attempts THEN 'FAILED' ELSE 'PENDING' END,
                last_error = ?2,
                available_at = ?3,
                started_at = NULL
             WHERE id = ?1",
            params![id, error, next_available],
        )
        .map_err(|error| error.to_string())?;
    if updated == 0 {
        return Err(format!("task not found: {id}"));
    }
    Ok(())
}

#[tauri::command]
pub fn local_recover_stale_tasks(
    app: tauri::AppHandle,
    timeout_seconds: i64,
) -> Result<i64, String> {
    let database = connection(&app)?;
    let now = chrono::Utc::now();
    let threshold = (now - chrono::Duration::seconds(timeout_seconds)).to_rfc3339();
    let updated = database
        .execute(
            "UPDATE tasks SET status='PENDING', started_at=NULL WHERE status='PROCESSING' AND started_at < ?",
            params![threshold],
        )
        .map_err(|error| error.to_string())?;
    Ok(updated as i64)
}

#[tauri::command]
pub fn local_retry_task(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let database = connection(&app)?;
    let now = chrono::Utc::now().to_rfc3339();
    let updated = database
        .execute(
            "UPDATE tasks SET status='PENDING', available_at=?1, last_error=NULL, started_at=NULL, finished_at=NULL WHERE id=?2 AND status='FAILED'",
            params![now, id],
        )
        .map_err(|error| error.to_string())?;
    if updated == 0 {
        return Err(format!("task not found or not failed: {id}"));
    }
    Ok(())
}

#[tauri::command]
pub fn local_list_recent_tasks(
    app: tauri::AppHandle,
    limit: i64,
) -> Result<Vec<LocalTask>, String> {
    let database = connection(&app)?;
    let mut statement = database
        .prepare("SELECT id,kind,document_id,payload,status,attempts,max_attempts,available_at,started_at,finished_at,last_error FROM tasks ORDER BY COALESCE(started_at, available_at) DESC LIMIT ?")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![limit], row_task)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

const KEYRING_SERVICE: &str = "ai-knowledge-browser";

fn keyring_set(account: &str, password: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())?;
    entry.set_password(password).map_err(|e| e.to_string())
}

fn keyring_delete(account: &str) -> Result<bool, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

fn row_provider(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalAIProvider> {
    let has_api_key: i64 = row.get(6)?;
    Ok(LocalAIProvider {
        id: row.get(0)?,
        provider_type: row.get(1)?,
        base_url: row.get(2)?,
        model: row.get(3)?,
        embedding_model: row.get(4)?,
        timeout_seconds: row.get(5)?,
        has_api_key: has_api_key != 0,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn validate_provider_base_url(value: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(value).map_err(|error| format!("invalid provider base url: {error}"))?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("provider base url must not contain credentials".into());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("provider base url must not contain a query or fragment".into());
    }
    let host = parsed.host_str().unwrap_or_default();
    let loopback = host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1";
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
        return Err("provider base url must use https; http is allowed only for loopback hosts".into());
    }
    Ok(parsed)
}

#[tauri::command]
pub fn local_save_ai_provider(
    app: tauri::AppHandle,
    id: Option<String>,
    provider_type: String,
    base_url: String,
    model: String,
    embedding_model: Option<String>,
    timeout_seconds: i64,
    api_key: Option<String>,
    clear_api_key: bool,
) -> Result<LocalAIProvider, String> {
    let trimmed_type = provider_type.trim();
    let trimmed_base = base_url.trim();
    let trimmed_model = model.trim();
    if trimmed_type.is_empty() || trimmed_base.is_empty() || trimmed_model.is_empty() {
        return Err("provider type, base url and model are required".into());
    }
    if !matches!(trimmed_type, "openai-compatible" | "ollama" | "deepseek" | "qwen" | "kimi" | "minimax") {
        return Err("unsupported provider type".into());
    }
    if trimmed_model.len() > 200 || embedding_model.as_deref().is_some_and(|value| value.len() > 200) {
        return Err("model name is too long".into());
    }
    if api_key.as_deref().is_some_and(|value| value.len() > 8192) {
        return Err("api key is too long".into());
    }
    if id.as_deref().is_some_and(|value| value.is_empty() || value.len() > 128 || !value.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))) {
        return Err("invalid provider id".into());
    }
    if !(1..=600).contains(&timeout_seconds) {
        return Err("timeout must be between 1 and 600 seconds".into());
    }
    let parsed_base = validate_provider_base_url(trimmed_base)?;
    let database = connection(&app)?;
    let now = chrono::Utc::now().to_rfc3339();
    let provider_id = id.unwrap_or_else(|| format!("provider-{}", uuid::Uuid::new_v4()));
    let key_change = if clear_api_key {
        keyring_delete(&provider_id)?;
        false
    } else if let Some(key) = api_key.as_deref() {
        if key.is_empty() {
            false
        } else {
            keyring_set(&provider_id, key)?;
            true
        }
    } else {
        // no change requested, infer has_api_key by checking the keyring
        keyring::Entry::new(KEYRING_SERVICE, &provider_id)
            .ok()
            .and_then(|entry| entry.get_password().ok().map(|_| true))
            .unwrap_or(false)
    };
    let existing: Option<(String, String)> = database
        .prepare("SELECT created_at, id FROM ai_providers WHERE id=?")
        .map_err(|e| e.to_string())?
        .query_row(params![provider_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .ok();
    let created_at = existing.as_ref().map(|row| row.0.clone()).unwrap_or_else(|| now.clone());
    database
        .execute(
            "INSERT INTO ai_providers(id,provider_type,base_url,model,embedding_model,timeout_seconds,has_api_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider_type=excluded.provider_type, base_url=excluded.base_url, model=excluded.model, embedding_model=excluded.embedding_model, timeout_seconds=excluded.timeout_seconds, has_api_key=excluded.has_api_key, updated_at=excluded.updated_at",
            params![provider_id, trimmed_type, parsed_base.as_str(), trimmed_model, embedding_model, timeout_seconds, key_change as i64, created_at, now],
        )
        .map_err(|e| e.to_string())?;
    let mut statement = database
        .prepare("SELECT id,provider_type,base_url,model,embedding_model,timeout_seconds,has_api_key,created_at,updated_at FROM ai_providers WHERE id=?")
        .map_err(|e| e.to_string())?;
    statement
        .query_row(params![provider_id], row_provider)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn local_get_ai_provider(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<LocalAIProvider>, String> {
    let database = connection(&app)?;
    let mut statement = database
        .prepare("SELECT id,provider_type,base_url,model,embedding_model,timeout_seconds,has_api_key,created_at,updated_at FROM ai_providers WHERE id=?")
        .map_err(|e| e.to_string())?;
    let mut rows = statement
        .query(params![id])
        .map_err(|e| e.to_string())?;
    match rows.next().map_err(|e| e.to_string())? {
        Some(row) => Ok(Some(row_provider(&row).map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn local_list_ai_providers(app: tauri::AppHandle) -> Result<Vec<LocalAIProvider>, String> {
    let database = connection(&app)?;
    let mut statement = database
        .prepare("SELECT id,provider_type,base_url,model,embedding_model,timeout_seconds,has_api_key,created_at,updated_at FROM ai_providers ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], row_provider)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn local_delete_ai_provider(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let _ = keyring_delete(&id);
    connection(&app)?
        .execute("DELETE FROM ai_providers WHERE id=?", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn local_find_document_by_url(
    app: tauri::AppHandle,
    url: String,
) -> Result<Option<LocalDocument>, String> {
    let database = connection(&app)?;
    let mut statement = database
        .prepare("SELECT id,title,url,source,author,summary,markdown,word_count,status,tags,auto_tags,created_at,starred FROM local_documents WHERE url = ?1 ORDER BY created_at DESC LIMIT 1")
        .map_err(|error| error.to_string())?;
    let mut rows = statement
        .query_map(params![url], row_document)
        .map_err(|error| error.to_string())?;
    match rows.next() {
        Some(Ok(document)) => Ok(Some(document)),
        Some(Err(error)) => Err(error.to_string()),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn local_toggle_starred(app: tauri::AppHandle, id: String, starred: bool) -> Result<bool, String> {
    let database = connection(&app)?;
    let updated = database
        .execute(
            "UPDATE local_documents SET starred=? WHERE id=?",
            params![starred as i64, id],
        )
        .map_err(|error| error.to_string())?;
    if updated == 0 {
        return Err(format!("document not found: {id}"));
    }
    Ok(starred)
}

#[tauri::command]
pub fn local_get_session(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let database = connection(&app)?;
    let mut statement = database
        .prepare("SELECT value FROM local_session WHERE key=?")
        .map_err(|error| error.to_string())?;
    match statement.query_row(params![key], |row| row.get::<_, String>(0)) {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn local_set_session(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let database = connection(&app)?;
    database
        .execute(
            "INSERT INTO local_session(key, value, updated_at) VALUES(?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            params![key, value, unix_seconds()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn local_list_history(app: tauri::AppHandle) -> Result<Vec<LocalHistoryEntry>, String> {
    let database = connection(&app)?;
    let mut statement = database
        .prepare("SELECT url,title,visited_at FROM browser_history ORDER BY visited_at DESC, id DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(LocalHistoryEntry {
                url: row.get(0)?,
                title: row.get(1)?,
                visited_at: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_record_reading_activity(
    app: tauri::AppHandle,
    url: String,
    title: String,
    active_seconds: i64,
    scroll_depth: f64,
) -> Result<(), String> {
    if url.len() > 8192 || title.len() > 2048 || active_seconds <= 0 || active_seconds > 60 {
        return Err("invalid reading activity".into());
    }
    let now = unix_seconds();
    connection(&app)?.execute(
        "INSERT INTO reading_activity(url,title,first_visited_at,last_visited_at,active_seconds,max_scroll_depth,visit_count)
         VALUES(?1,?2,?3,?3,?4,?5,1)
         ON CONFLICT(url) DO UPDATE SET title=excluded.title,last_visited_at=excluded.last_visited_at,
         active_seconds=reading_activity.active_seconds+excluded.active_seconds,
         max_scroll_depth=MAX(reading_activity.max_scroll_depth,excluded.max_scroll_depth)",
        params![url, title, now, active_seconds, scroll_depth.clamp(0.0, 1.0)],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn local_list_reading_activity(app: tauri::AppHandle) -> Result<Vec<LocalReadingActivity>, String> {
    let database = connection(&app)?;
    let mut statement = database.prepare(
        "SELECT url,title,first_visited_at,last_visited_at,active_seconds,max_scroll_depth,visit_count,excerpt,markdown,captured_at FROM reading_activity ORDER BY last_visited_at DESC"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map([], |row| Ok(LocalReadingActivity {
        url: row.get(0)?, title: row.get(1)?, first_visited_at: row.get(2)?, last_visited_at: row.get(3)?,
        active_seconds: row.get(4)?, max_scroll_depth: row.get(5)?, visit_count: row.get(6)?,
        excerpt: row.get(7)?, markdown: row.get(8)?, captured_at: row.get(9)?,
    })).map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_save_reading_snapshot(app: tauri::AppHandle, url: String, excerpt: String, markdown: String) -> Result<(), String> {
    if url.len() > 8192 || excerpt.len() > 16_384 || markdown.len() > 4 * 1024 * 1024 {
        return Err("reading snapshot is too large".into());
    }
    let updated = connection(&app)?.execute(
        "UPDATE reading_activity SET excerpt=?2,markdown=?3,captured_at=?4 WHERE url=?1",
        params![url, excerpt, markdown, unix_seconds()],
    ).map_err(|error| error.to_string())?;
    if updated == 0 { return Err("reading activity not found".into()); }
    Ok(())
}

fn reading_snapshot_stats(database: &Connection) -> Result<ReadingSnapshotStats, String> {
    database.query_row(
        "SELECT COUNT(markdown),COALESCE(SUM(LENGTH(CAST(markdown AS BLOB))+LENGTH(CAST(COALESCE(excerpt,'') AS BLOB))),0) FROM reading_activity WHERE markdown IS NOT NULL",
        [], |row| Ok(ReadingSnapshotStats { count: row.get(0)?, bytes: row.get(1)? })
    ).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_reading_snapshot_stats(app: tauri::AppHandle) -> Result<ReadingSnapshotStats, String> {
    reading_snapshot_stats(&connection(&app)?)
}

#[tauri::command]
pub fn local_delete_reading_snapshot(app: tauri::AppHandle, url: String) -> Result<(), String> {
    connection(&app)?.execute(
        "UPDATE reading_activity SET excerpt=NULL,markdown=NULL,captured_at=NULL WHERE url=?1", params![url]
    ).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn local_clear_reading_snapshots(app: tauri::AppHandle) -> Result<ReadingSnapshotStats, String> {
    let database = connection(&app)?;
    database.execute("UPDATE reading_activity SET excerpt=NULL,markdown=NULL,captured_at=NULL", [])
        .map_err(|error| error.to_string())?;
    reading_snapshot_stats(&database)
}

#[tauri::command]
pub fn local_purge_reading_snapshots(app: tauri::AppHandle, retention_days: i64, max_bytes: i64) -> Result<ReadingSnapshotStats, String> {
    if !(1..=3650).contains(&retention_days) || !(1024 * 1024..=10 * 1024 * 1024 * 1024_i64).contains(&max_bytes) {
        return Err("invalid snapshot retention settings".into());
    }
    let database = connection(&app)?;
    let cutoff = unix_seconds() - retention_days * 86_400;
    database.execute(
        "UPDATE reading_activity SET excerpt=NULL,markdown=NULL,captured_at=NULL WHERE captured_at IS NOT NULL AND captured_at<?1", params![cutoff]
    ).map_err(|error| error.to_string())?;
    while reading_snapshot_stats(&database)?.bytes > max_bytes {
        let url: Option<String> = database.query_row(
            "SELECT url FROM reading_activity WHERE markdown IS NOT NULL ORDER BY captured_at ASC LIMIT 1", [], |row| row.get(0)
        ).optional().map_err(|error| error.to_string())?;
        let Some(url) = url else { break };
        database.execute("UPDATE reading_activity SET excerpt=NULL,markdown=NULL,captured_at=NULL WHERE url=?1", params![url])
            .map_err(|error| error.to_string())?;
    }
    reading_snapshot_stats(&database)
}

#[tauri::command]
pub fn local_add_history(app: tauri::AppHandle, entry: LocalHistoryEntry) -> Result<(), String> {
    validate_history_entry(&entry)?;
    let database = connection(&app)?;
    database
        .execute(
            "INSERT INTO browser_history(url,title,visited_at) VALUES(?,?,?)",
            params![entry.url, entry.title, entry.visited_at],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn local_clear_history(app: tauri::AppHandle, since: Option<i64>) -> Result<i64, String> {
    let database = connection(&app)?;
    let deleted = match since {
        Some(cutoff) if cutoff > 0 => database.execute(
            "DELETE FROM browser_history WHERE visited_at >= ?",
            params![cutoff],
        ),
        Some(_) => return Err("history cutoff must be positive".into()),
        None => database.execute("DELETE FROM browser_history", []),
    }
    .map_err(|error| error.to_string())?;
    Ok(deleted as i64)
}

#[tauri::command]
pub fn local_get_browser_workspace(app: tauri::AppHandle) -> Result<Option<LocalBrowserWorkspace>, String> {
    let database = connection(&app)?;
    let active = match database.query_row("SELECT active_tab_id FROM browser_sessions WHERE id='main'", [], |row| row.get::<_, String>(0)) {
        Ok(value) => value,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let mut statement = database.prepare("SELECT payload FROM browser_tabs WHERE session_id='main' ORDER BY position")
        .map_err(|error| error.to_string())?;
    let tabs = statement.query_map([], |row| row.get::<_, String>(0)).map_err(|error| error.to_string())?
        .filter_map(|raw| raw.ok().and_then(|value| serde_json::from_str(&value).ok()))
        .collect();
    Ok(Some(LocalBrowserWorkspace { tabs, active_tab_id: active }))
}

#[tauri::command]
pub fn local_save_browser_workspace(app: tauri::AppHandle, workspace: LocalBrowserWorkspace) -> Result<(), String> {
    if workspace.tabs.is_empty() || workspace.tabs.len() > 500 { return Err("invalid browser workspace".into()); }
    let mut database = connection(&app)?;
    let transaction = database.transaction().map_err(|error| error.to_string())?;
    transaction.execute("INSERT INTO browser_sessions(id,active_tab_id,updated_at) VALUES('main',?,?) ON CONFLICT(id) DO UPDATE SET active_tab_id=excluded.active_tab_id,updated_at=excluded.updated_at", params![workspace.active_tab_id, unix_seconds()]).map_err(|error| error.to_string())?;
    transaction.execute("DELETE FROM browser_tabs WHERE session_id='main'", []).map_err(|error| error.to_string())?;
    for (position, tab) in workspace.tabs.into_iter().enumerate() {
        let id = tab.get("id").and_then(|value| value.as_str()).ok_or("tab id is required")?;
        if id.len() > 128 { return Err("invalid tab id".into()); }
        let payload = serde_json::to_string(&tab).map_err(|error| error.to_string())?;
        transaction.execute("INSERT INTO browser_tabs(id,session_id,position,payload,updated_at) VALUES(?,'main',?,?,?)", params![id, position as i64, payload, unix_seconds()]).map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn validate_workspace_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() { return Err("workspace name is required".into()); }
    if trimmed.chars().count() > 80 { return Err("workspace name too long (max 80 chars)".into()); }
    Ok(())
}

fn count_tabs(payload: &serde_json::Value) -> i64 {
    payload.get("tabs").and_then(|v| v.as_array()).map(|arr| arr.len() as i64).unwrap_or(0)
}

#[tauri::command]
pub fn local_list_workspaces(app: tauri::AppHandle) -> Result<Vec<LocalWorkspaceSummary>, String> {
    let database = connection(&app)?;
    let mut statement = database.prepare("SELECT id, name, description, tab_count, created_at, updated_at FROM workspaces ORDER BY updated_at DESC LIMIT 200")
        .map_err(|error| error.to_string())?;
    let rows = statement.query_map([], |row| Ok(LocalWorkspaceSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        tab_count: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })).map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_get_workspace(app: tauri::AppHandle, id: String) -> Result<Option<LocalWorkspace>, String> {
    if id.trim().is_empty() { return Err("workspace id is required".into()); }
    let database = connection(&app)?;
    let row = database.query_row(
        "SELECT id, name, description, payload, created_at, updated_at FROM workspaces WHERE id = ?",
        params![id],
        |row| {
                let payload_raw: String = row.get(3)?;
                let payload: serde_json::Value = serde_json::from_str(&payload_raw).unwrap_or_else(|_| serde_json::json!({}));
                Ok(LocalWorkspace {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    payload,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        );
    match row {
        Ok(workspace) => Ok(Some(workspace)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn local_save_workspace(app: tauri::AppHandle, input: LocalWorkspaceSaveInput) -> Result<LocalWorkspaceSummary, String> {
    validate_workspace_name(&input.name)?;
    if input.description.chars().count() > 240 { return Err("workspace description too long (max 240 chars)".into()); }
    let database = connection(&app)?;
    let now = chrono::Utc::now().to_rfc3339();
    let epoch = unix_seconds();
    let tab_count = count_tabs(&input.payload);
    let payload_str = serde_json::to_string(&input.payload).map_err(|error| error.to_string())?;
    let id = match input.id.as_deref().filter(|value| !value.trim().is_empty()) {
        Some(existing) => existing.to_string(),
        None => format!("ws-{}", uuid::Uuid::new_v4()),
    };
    if id.len() > 128 { return Err("invalid workspace id".into()); }
    database.execute(
        "INSERT INTO workspaces (id, name, description, tab_count, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, tab_count=excluded.tab_count, payload=excluded.payload, updated_at=excluded.updated_at",
        params![id, input.name.trim(), input.description, tab_count, payload_str, now, now],
    ).map_err(|error| error.to_string())?;
    database.query_row(
        "SELECT id, name, description, tab_count, created_at, updated_at FROM workspaces WHERE id = ?",
        params![id],
        |row| Ok(LocalWorkspaceSummary {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            tab_count: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        }),
    ).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_delete_workspace(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if id.trim().is_empty() { return Err("workspace id is required".into()); }
    let database = connection(&app)?;
    database.execute("DELETE FROM workspaces WHERE id = ?", params![id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn local_list_closed_tabs(app: tauri::AppHandle) -> Result<Vec<LocalClosedTab>, String> {
    let database = connection(&app)?;
    let mut statement = database.prepare("SELECT id,url,title,favicon,closed_at FROM closed_tabs ORDER BY closed_at DESC LIMIT 20").map_err(|error| error.to_string())?;
    let rows = statement.query_map([], |row| Ok(LocalClosedTab { id: row.get(0)?, url: row.get(1)?, title: row.get(2)?, favicon: row.get(3)?, closed_at: row.get(4)? })).map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_save_closed_tab(app: tauri::AppHandle, tab: LocalClosedTab) -> Result<(), String> {
    validate_history_entry(&LocalHistoryEntry { url: tab.url.clone(), title: tab.title.clone(), visited_at: tab.closed_at })?;
    let database = connection(&app)?;
    database.execute("INSERT OR REPLACE INTO closed_tabs(id,url,title,favicon,closed_at) VALUES(?,?,?,?,?)", params![tab.id, tab.url, tab.title, tab.favicon, tab.closed_at]).map_err(|error| error.to_string())?;
    database.execute("DELETE FROM closed_tabs WHERE id NOT IN (SELECT id FROM closed_tabs ORDER BY closed_at DESC LIMIT 20)", []).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn local_delete_closed_tab(app: tauri::AppHandle, id: String) -> Result<(), String> {
    connection(&app)?.execute("DELETE FROM closed_tabs WHERE id=?", params![id]).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn local_clear_closed_tabs(app: tauri::AppHandle) -> Result<(), String> {
    connection(&app)?.execute("DELETE FROM closed_tabs", []).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn local_list_site_permissions(app: tauri::AppHandle) -> Result<Vec<LocalSitePermission>, String> {
    let database = connection(&app)?;
    let mut statement = database.prepare("SELECT origin,permission_kind,decision FROM site_permissions ORDER BY origin,permission_kind").map_err(|error| error.to_string())?;
    let rows = statement.query_map([], |row| Ok(LocalSitePermission { origin: row.get(0)?, permission_kind: row.get(1)?, decision: row.get(2)? })).map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_replace_site_permissions(app: tauri::AppHandle, permissions: Vec<LocalSitePermission>) -> Result<(), String> {
    let mut database = connection(&app)?;
    let transaction = database.transaction().map_err(|error| error.to_string())?;
    transaction.execute("DELETE FROM site_permissions", []).map_err(|error| error.to_string())?;
    for permission in permissions {
        if !matches!(permission.permission_kind.as_str(), "camera" | "microphone" | "location" | "notifications" | "clipboard") || !matches!(permission.decision.as_str(), "allow" | "deny" | "ask") { return Err("invalid site permission".into()); }
        let parsed = url::Url::parse(&permission.origin).map_err(|error| error.to_string())?;
        if !matches!(parsed.scheme(), "http" | "https") || parsed.origin().ascii_serialization() != permission.origin { return Err("invalid permission origin".into()); }
        transaction.execute("INSERT INTO site_permissions(origin,permission_kind,decision,updated_at) VALUES(?,?,?,?)", params![permission.origin, permission.permission_kind, permission.decision, unix_seconds()]).map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

pub(crate) fn site_permission_decision(app: &tauri::AppHandle, origin: &str, kind: &str) -> Option<String> {
    let database = connection(app).ok()?;
    database.query_row("SELECT decision FROM site_permissions WHERE origin=? AND permission_kind=?", params![origin, kind], |row| row.get(0)).optional().ok().flatten()
}

fn credential_key(id: &str) -> String { format!("browser-password:{id}") }

fn validate_credential_origin(origin: &str) -> Result<(), String> {
    let parsed = url::Url::parse(origin).map_err(|_| "invalid credential origin".to_string())?;
    if parsed.scheme() != "https" || parsed.origin().ascii_serialization() != origin {
        return Err("passwords can only be saved for an HTTPS origin".into());
    }
    Ok(())
}

#[tauri::command]
pub fn browser_password_save(app: tauri::AppHandle, origin: String, username: String, password: String) -> Result<SavedCredential, String> {
    validate_credential_origin(&origin)?;
    let username = username.trim().to_string();
    if username.is_empty() || username.len() > 320 || password.is_empty() || password.len() > 4096 { return Err("invalid username or password".into()) }
    let database = connection(&app)?;
    let existing: Option<String> = database.query_row("SELECT id FROM saved_credentials WHERE origin=? AND username=?", params![origin, username], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    let id = existing.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    keyring_set(&credential_key(&id), &password)?;
    let now = unix_seconds();
    database.execute("INSERT INTO saved_credentials(id,origin,username,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(origin,username) DO UPDATE SET updated_at=excluded.updated_at", params![id, origin, username, now, now]).map_err(|e| e.to_string())?;
    Ok(SavedCredential { id, origin, username, updated_at: now })
}

#[tauri::command]
pub fn browser_password_list(app: tauri::AppHandle) -> Result<Vec<SavedCredential>, String> {
    let database = connection(&app)?;
    let mut statement = database.prepare("SELECT id,origin,username,updated_at FROM saved_credentials ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| Ok(SavedCredential { id: row.get(0)?, origin: row.get(1)?, username: row.get(2)?, updated_at: row.get(3)? })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub(crate) fn password_for_origin(app: &tauri::AppHandle, origin: &str) -> Result<Option<AutofillCredential>, String> {
    validate_credential_origin(origin)?;
    let database = connection(app)?;
    let row: Option<(String, String)> = database.query_row("SELECT id,username FROM saved_credentials WHERE origin=? ORDER BY updated_at DESC LIMIT 1", [origin], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(|e| e.to_string())?;
    let Some((id, username)) = row else { return Ok(None) };
    let password = keyring::Entry::new(KEYRING_SERVICE, &credential_key(&id)).map_err(|e| e.to_string())?.get_password().map_err(|e| e.to_string())?;
    Ok(Some(AutofillCredential { username, password }))
}

#[tauri::command]
pub fn browser_password_delete(app: tauri::AppHandle, id: String) -> Result<bool, String> {
    let database = connection(&app)?;
    let changed = database.execute("DELETE FROM saved_credentials WHERE id=?", [&id]).map_err(|e| e.to_string())? > 0;
    if changed { let _ = keyring_delete(&credential_key(&id)); }
    Ok(changed)
}

#[tauri::command]
pub fn browser_password_generate(length: Option<usize>) -> Result<String, String> {
    let length = length.unwrap_or(20).clamp(16, 64);
    let seed = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let alphabet = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
    let mut out = String::with_capacity(length);
    for (index, byte) in seed.bytes().enumerate().take(length.saturating_sub(4)) { out.push(alphabet[(byte as usize + index * 17) % alphabet.len()] as char); }
    out.push_str("A9!a");
    Ok(out.chars().take(length).collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBackup {
    version: i64,
    exported_at: String,
    documents: Vec<LocalDocument>,
    session: Vec<LocalSessionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSessionEntry {
    key: String,
    value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalImportSummary {
    documents_inserted: i64,
    documents_skipped: i64,
    session_inserted: i64,
}

#[tauri::command]
pub fn local_export_backup(app: tauri::AppHandle) -> Result<LocalBackup, String> {
    let database = connection(&app)?;
    let mut statement = database
        .prepare("SELECT id,title,url,source,author,summary,markdown,word_count,status,tags,auto_tags,created_at,starred FROM local_documents ORDER BY created_at ASC")
        .map_err(|error| error.to_string())?;
    let documents = statement
        .query_map([], row_document)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare("SELECT key, value FROM local_session ORDER BY key ASC")
        .map_err(|error| error.to_string())?;
    let session = statement
        .query_map([], |row| {
            Ok(LocalSessionEntry {
                key: row.get(0)?,
                value: row.get(1)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(LocalBackup {
        version: 1,
        exported_at: unix_seconds().to_string(),
        documents,
        session,
    })
}

#[tauri::command]
pub fn local_import_backup(app: tauri::AppHandle, backup: LocalBackup) -> Result<LocalImportSummary, String> {
    if backup.version != 1 {
        return Err(format!("unsupported backup version: {}", backup.version));
    }
    let database = connection(&app)?;
    let mut documents_inserted = 0;
    let mut documents_skipped = 0;
    for document in backup.documents {
        let tags = serde_json::to_string(&document.tags).map_err(|error| error.to_string())?;
        let auto_tags = serde_json::to_string(&document.auto_tags).unwrap_or_else(|_| "[]".to_string());
        let result = database.execute(
            "INSERT OR REPLACE INTO local_documents(id,title,url,source,author,summary,markdown,word_count,status,tags,auto_tags,created_at,starred) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            params![document.id, document.title, document.url, document.source, document.author, document.summary, document.markdown, document.word_count, document.status, tags, auto_tags, document.created_at, document.starred as i64],
        );
        match result {
            Ok(_) => documents_inserted += 1,
            Err(_) => documents_skipped += 1,
        }
    }
    let mut session_inserted = 0;
    for entry in backup.session {
        database
            .execute(
                "INSERT INTO local_session(key, value, updated_at) VALUES(?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                params![entry.key, entry.value, unix_seconds()],
            )
            .map_err(|error| error.to_string())?;
        session_inserted += 1;
    }
    Ok(LocalImportSummary {
        documents_inserted,
        documents_skipped,
        session_inserted,
    })
}

#[tauri::command]
pub fn local_migration_status(app: tauri::AppHandle) -> Result<LocalMigrationStatus, String> {
    let database = connection(&app)?;
    let version: i64 = database
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let latest = MIGRATIONS.iter().map(|(version, _)| *version).max().unwrap_or(0);
    Ok(LocalMigrationStatus {
        version,
        pending: (latest - version).max(0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fresh() -> Connection {
        Connection::open_in_memory().expect("open in-memory db")
    }

    #[test]
    fn document_deserialization_defaults_missing_auto_tags() {
        let document: LocalDocument = serde_json::from_value(serde_json::json!({
            "id": "local-test",
            "title": "Test",
            "url": "https://example.com",
            "source": "example.com",
            "wordCount": 1,
            "status": "READY",
            "tags": ["Inbox"],
            "createdAt": "2026-09-24T00:00:00.000Z",
            "starred": false
        }))
        .expect("documents created by older clients remain valid");

        assert!(document.auto_tags.is_empty());
    }

    #[test]
    fn applies_v1_on_fresh_database() {
        let mut database = fresh();
        run_migrations(&mut database).unwrap();
        let count: i64 = database
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='local_documents'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let versions: Vec<i64> = database
            .prepare("SELECT version FROM schema_version ORDER BY version")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(versions, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    }

    #[test]
    fn baselines_existing_table_without_version_record() {
        let mut database = fresh();
        database
            .execute_batch(
                "CREATE TABLE local_documents (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    url TEXT NOT NULL,
                    source TEXT,
                    author TEXT,
                    summary TEXT,
                    markdown TEXT,
                    word_count INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL,
                    tags TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL
                );
                CREATE INDEX idx_local_documents_created_at ON local_documents(created_at DESC);",
            )
            .unwrap();
        run_migrations(&mut database).unwrap();
        let versions: Vec<i64> = database
            .prepare("SELECT version FROM schema_version ORDER BY version")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(versions, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    }

    #[test]
    fn migration_runner_is_idempotent() {
        let mut database = fresh();
        run_migrations(&mut database).unwrap();
        run_migrations(&mut database).unwrap();
        run_migrations(&mut database).unwrap();
        let versions: Vec<i64> = database
            .prepare("SELECT version FROM schema_version ORDER BY version")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(versions, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    }

    #[test]
    fn v10_migrates_legacy_history_json_into_rows() {
        let mut database = fresh();
        run_migrations(&mut database).unwrap();
        database.execute("DELETE FROM schema_version WHERE version=10", []).unwrap();
        database.execute("DROP TABLE browser_history", []).unwrap();
        database.execute(
            "INSERT INTO local_session(key,value,updated_at) VALUES('browser.history',?,1)",
            params![r#"[{"url":"https://example.com/a","title":"A","visitedAt":1000},{"url":"javascript:alert(1)","title":"blocked","visitedAt":1001}]"#],
        ).unwrap();

        run_migrations(&mut database).unwrap();

        let rows: Vec<(String, String, i64)> = database
            .prepare("SELECT url,title,visited_at FROM browser_history")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(rows, vec![("https://example.com/a".into(), "A".into(), 1000)]);
        let legacy_count: i64 = database
            .query_row("SELECT COUNT(*) FROM local_session WHERE key='browser.history'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(legacy_count, 0);
    }

    #[test]
    fn v2_migration_adds_starred_column_to_existing_table() {
        let mut database = fresh();
        database
            .execute_batch(
                "CREATE TABLE local_documents (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    url TEXT NOT NULL,
                    source TEXT,
                    author TEXT,
                    summary TEXT,
                    markdown TEXT,
                    word_count INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL,
                    tags TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL
                );",
            )
            .unwrap();
        database
            .execute(
                "INSERT INTO local_documents(id,title,url,word_count,status,tags,created_at) VALUES(?,?,?,?,?,?,?)",
                rusqlite::params!["local-old", "Legacy", "https://example.com/old", 0, "READY", "[]", "2026-01-01T00:00:00Z"],
            )
            .unwrap();
        run_migrations(&mut database).unwrap();
        let starred: i64 = database
            .query_row(
                "SELECT starred FROM local_documents WHERE id='local-old'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(starred, 0);
        database
            .execute(
                "UPDATE local_documents SET starred=1 WHERE id='local-old'",
                [],
            )
            .unwrap();
        let starred: i64 = database
            .query_row(
                "SELECT starred FROM local_documents WHERE id='local-old'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(starred, 1);
    }

    #[test]
    fn v3_migration_creates_session_table() {
        let mut database = fresh();
        run_migrations(&mut database).unwrap();
        let count: i64 = database
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='local_session'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn round_trips_documents_and_session_via_backup_struct() {
        let mut source = fresh();
        run_migrations(&mut source).unwrap();
        source
            .execute(
                "INSERT INTO local_documents(id,title,url,word_count,status,tags,created_at,starred) VALUES(?,?,?,?,?,?,?,?)",
                params!["local-1", "Title", "https://example.com/", 10, "READY", "[\"x\"]", "2026-01-01T00:00:00Z", 1],
            )
            .unwrap();
        source
            .execute(
                "INSERT INTO local_session(key,value,updated_at) VALUES(?,?,?)",
                params!["browser.tabs", "{\"tabs\":[]}", 1_700_000_000_i64],
            )
            .unwrap();

        // Export by mirroring the SELECT used in local_export_backup.
        let mut stmt = source.prepare("SELECT id,title,url,source,author,summary,markdown,word_count,status,tags,auto_tags,created_at,starred FROM local_documents ORDER BY created_at ASC").unwrap();
        let documents: Vec<LocalDocument> = stmt
            .query_map([], row_document)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let mut stmt = source.prepare("SELECT key, value FROM local_session ORDER BY key ASC").unwrap();
        let session: Vec<LocalSessionEntry> = stmt
            .query_map([], |row| Ok(LocalSessionEntry { key: row.get(0)?, value: row.get(1)? }))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let backup = LocalBackup { version: 1, exported_at: "1".into(), documents, session };

        // Import into a fresh database.
        let mut target = fresh();
        run_migrations(&mut target).unwrap();
        let summary = local_import_backup_for_test(&mut target, backup).unwrap();
        assert_eq!(summary.documents_inserted, 1);
        assert_eq!(summary.documents_skipped, 0);
        assert_eq!(summary.session_inserted, 1);

        let restored_title: String = target
            .query_row("SELECT title FROM local_documents WHERE id='local-1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(restored_title, "Title");
        let restored_session: String = target
            .query_row("SELECT value FROM local_session WHERE key='browser.tabs'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(restored_session, "{\"tabs\":[]}");
    }

    #[test]
    fn import_rejects_unsupported_backup_version() {
        let mut database = fresh();
        run_migrations(&mut database).unwrap();
        let backup = LocalBackup { version: 99, exported_at: "0".into(), documents: vec![], session: vec![] };
        let result = local_import_backup_for_test(&mut database, backup);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unsupported backup version"));
    }

    #[test]
    fn provider_urls_require_https_except_for_loopback() {
        assert!(validate_provider_base_url("https://api.example.com/v1").is_ok());
        assert!(validate_provider_base_url("http://127.0.0.1:11434").is_ok());
        assert!(validate_provider_base_url("http://localhost:11434").is_ok());
        assert!(validate_provider_base_url("http://api.example.com/v1").is_err());
        assert!(validate_provider_base_url("https://user:pass@api.example.com").is_err());
        assert!(validate_provider_base_url("https://api.example.com?v=1").is_err());
    }

    #[test]
    fn workspace_validators_reject_empty_and_oversize_names() {
        assert!(validate_workspace_name("").is_err());
        assert!(validate_workspace_name("   ").is_err());
        let long = "中".repeat(81);
        assert!(validate_workspace_name(&long).is_err());
        assert!(validate_workspace_name("  工作日  ").is_ok());
    }

    #[test]
    fn count_tabs_reads_payload_array_length() {
        let payload = serde_json::json!({ "tabs": [{}, {}, {}] });
        assert_eq!(count_tabs(&payload), 3);
        assert_eq!(count_tabs(&serde_json::json!({})), 0);
        assert_eq!(count_tabs(&serde_json::json!({ "tabs": "not-an-array" })), 0);
    }

    #[test]
    fn workspace_table_exists_after_v13_migration() {
        let mut database = fresh();
        run_migrations(&mut database).unwrap();
        let count: i64 = database
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='workspaces'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let versions: Vec<i64> = database
            .prepare("SELECT version FROM schema_version ORDER BY version")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(versions.contains(&13), "schema_version must include 13, got {versions:?}");
    }

    fn local_import_backup_for_test(database: &mut Connection, backup: LocalBackup) -> Result<LocalImportSummary, String> {
        if backup.version != 1 {
            return Err(format!("unsupported backup version: {}", backup.version));
        }
        let mut documents_inserted = 0;
        let mut documents_skipped = 0;
        for document in backup.documents {
            let tags = serde_json::to_string(&document.tags).map_err(|error| error.to_string())?;
            let auto_tags = serde_json::to_string(&document.auto_tags).unwrap_or_else(|_| "[]".to_string());
            let result = database.execute(
                "INSERT OR REPLACE INTO local_documents(id,title,url,source,author,summary,markdown,word_count,status,tags,auto_tags,created_at,starred) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                params![document.id, document.title, document.url, document.source, document.author, document.summary, document.markdown, document.word_count, document.status, tags, auto_tags, document.created_at, document.starred as i64],
            );
            match result {
                Ok(_) => documents_inserted += 1,
                Err(_) => documents_skipped += 1,
            }
        }
        let mut session_inserted = 0;
        for entry in backup.session {
            database.execute(
                "INSERT INTO local_session(key, value, updated_at) VALUES(?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                params![entry.key, entry.value, 1_i64],
            ).map_err(|error| error.to_string())?;
            session_inserted += 1;
        }
        Ok(LocalImportSummary { documents_inserted, documents_skipped, session_inserted })
    }
}
