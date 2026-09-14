use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;

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
}

fn connection(app: &tauri::AppHandle) -> Result<Connection, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let database = Connection::open(directory.join("knowledge.db")).map_err(|error| error.to_string())?;
    database.execute_batch("CREATE TABLE IF NOT EXISTS local_documents (
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
    ); CREATE INDEX IF NOT EXISTS idx_local_documents_created_at ON local_documents(created_at DESC);")
        .map_err(|error| error.to_string())?;
    Ok(database)
}

fn row_document(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalDocument> {
    let tags: String = row.get(9)?;
    Ok(LocalDocument {
        id: row.get(0)?, title: row.get(1)?, url: row.get(2)?, source: row.get(3)?,
        author: row.get(4)?, summary: row.get(5)?, markdown: row.get(6)?, word_count: row.get(7)?,
        status: row.get(8)?, tags: serde_json::from_str(&tags).unwrap_or_default(), created_at: row.get(10)?,
    })
}

#[tauri::command]
pub fn local_list_documents(app: tauri::AppHandle, query: String) -> Result<Vec<LocalDocument>, String> {
    let database = connection(&app)?;
    let pattern = format!("%{}%", query.trim());
    let mut statement = database.prepare("SELECT id,title,url,source,author,summary,markdown,word_count,status,tags,created_at FROM local_documents WHERE ?1 = '%%' OR title LIKE ?1 OR markdown LIKE ?1 OR summary LIKE ?1 OR tags LIKE ?1 ORDER BY created_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![pattern], row_document).map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_save_document(app: tauri::AppHandle, document: LocalDocument) -> Result<LocalDocument, String> {
    let database = connection(&app)?;
    let tags = serde_json::to_string(&document.tags).map_err(|error| error.to_string())?;
    database.execute("INSERT OR REPLACE INTO local_documents(id,title,url,source,author,summary,markdown,word_count,status,tags,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", params![document.id, document.title, document.url, document.source, document.author, document.summary, document.markdown, document.word_count, document.status, tags, document.created_at])
        .map_err(|error| error.to_string())?;
    Ok(document)
}

#[tauri::command]
pub fn local_get_document(app: tauri::AppHandle, id: String) -> Result<Option<LocalDocument>, String> {
    let database = connection(&app)?;
    let mut statement = database.prepare("SELECT id,title,url,source,author,summary,markdown,word_count,status,tags,created_at FROM local_documents WHERE id=?")
        .map_err(|error| error.to_string())?;
    match statement.query_row(params![id], row_document) {
        Ok(document) => Ok(Some(document)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn local_delete_document(app: tauri::AppHandle, id: String) -> Result<(), String> {
    connection(&app)?.execute("DELETE FROM local_documents WHERE id=?", params![id]).map_err(|error| error.to_string())?;
    Ok(())
}
