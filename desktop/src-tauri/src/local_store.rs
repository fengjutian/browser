use rusqlite::{params, Connection};
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
    created_at: String,
    starred: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMigrationStatus {
    version: i64,
    pending: i64,
}

fn connection(app: &tauri::AppHandle) -> Result<Connection, String> {
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

fn run_migrations(database: &mut Connection) -> Result<(), String> {
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
    let starred: i64 = row.get(11)?;
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
    let mut statement = database.prepare("SELECT id,title,url,source,author,summary,markdown,word_count,status,tags,created_at,starred FROM local_documents WHERE ?1 = '%%' OR title LIKE ?1 OR markdown LIKE ?1 OR summary LIKE ?1 OR tags LIKE ?1 ORDER BY starred DESC, created_at DESC")
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
    database.execute("INSERT OR REPLACE INTO local_documents(id,title,url,source,author,summary,markdown,word_count,status,tags,created_at,starred) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", params![document.id, document.title, document.url, document.source, document.author, document.summary, document.markdown, document.word_count, document.status, tags, document.created_at, document.starred as i64])
        .map_err(|error| error.to_string())?;
    Ok(document)
}

#[tauri::command]
pub fn local_get_document(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<LocalDocument>, String> {
    let database = connection(&app)?;
    let mut statement = database.prepare("SELECT id,title,url,source,author,summary,markdown,word_count,status,tags,created_at,starred FROM local_documents WHERE id=?")
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
        .prepare("SELECT id,title,url,source,author,summary,markdown,word_count,status,tags,created_at,starred FROM local_documents ORDER BY created_at ASC")
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
        let result = database.execute(
            "INSERT OR REPLACE INTO local_documents(id,title,url,source,author,summary,markdown,word_count,status,tags,created_at,starred) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            params![document.id, document.title, document.url, document.source, document.author, document.summary, document.markdown, document.word_count, document.status, tags, document.created_at, document.starred as i64],
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
        assert_eq!(versions, vec![1, 2, 3]);
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
        assert_eq!(versions, vec![1, 2, 3]);
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
        assert_eq!(versions, vec![1, 2, 3]);
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
        let mut stmt = source.prepare("SELECT id,title,url,source,author,summary,markdown,word_count,status,tags,created_at,starred FROM local_documents ORDER BY created_at ASC").unwrap();
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

    fn local_import_backup_for_test(database: &mut Connection, backup: LocalBackup) -> Result<LocalImportSummary, String> {
        if backup.version != 1 {
            return Err(format!("unsupported backup version: {}", backup.version));
        }
        let mut documents_inserted = 0;
        let mut documents_skipped = 0;
        for document in backup.documents {
            let tags = serde_json::to_string(&document.tags).map_err(|error| error.to_string())?;
            let result = database.execute(
                "INSERT OR REPLACE INTO local_documents(id,title,url,source,author,summary,markdown,word_count,status,tags,created_at,starred) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                params![document.id, document.title, document.url, document.source, document.author, document.summary, document.markdown, document.word_count, document.status, tags, document.created_at, document.starred as i64],
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