//! Bookmark persistence + commands.
//!
//! Bookmarks live in the `bookmarks` table (migration v12). The table holds
//! the canonical list the user has starred; CRUD is exposed via 5 commands
//! so the React palette can list, add, remove, rename and reorder entries
//! without round-tripping through `local_store` directly.
//!
//! Folder assignment is a single string (default `""` = unsorted bar). When
//! the user later asks for folders UI we extend this with a `bookmark_folders`
//! table — not needed yet because the search palette lists every bookmark and
//! filters client-side.

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkRecord {
    pub id: String,
    pub url: String,
    pub title: String,
    pub favicon: Option<String>,
    pub folder: String,
    pub note: String,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkInput {
    pub id: String,
    pub url: String,
    pub title: String,
    pub favicon: Option<String>,
    pub folder: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkPatch {
    pub title: Option<String>,
    pub folder: Option<String>,
    pub note: Option<String>,
    pub position: Option<i64>,
    pub favicon: Option<String>,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn row_to_record(row: &Row<'_>) -> rusqlite::Result<BookmarkRecord> {
    Ok(BookmarkRecord {
        id: row.get("id")?,
        url: row.get("url")?,
        title: row.get("title")?,
        favicon: row.get("favicon")?,
        folder: row.get("folder")?,
        note: row.get("note")?,
        position: row.get("position")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn validate_input(input: &BookmarkInput) -> Result<(), String> {
    if input.id.trim().is_empty() {
        return Err("bookmark id is required".into());
    }
    if input.url.trim().is_empty() {
        return Err("bookmark url is required".into());
    }
    if input.title.trim().is_empty() {
        return Err("bookmark title is required".into());
    }
    Ok(())
}

pub fn insert_bookmark(conn: &Connection, input: BookmarkInput) -> Result<BookmarkRecord, String> {
    validate_input(&input)?;
    let now = now_iso();
    let folder = input.folder.clone().unwrap_or_default();
    let note = input.note.clone().unwrap_or_default();
    let position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM bookmarks",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO bookmarks(id, url, title, favicon, folder, note, position, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            url = excluded.url,
            title = excluded.title,
            favicon = excluded.favicon,
            folder = excluded.folder,
            note = excluded.note,
            updated_at = excluded.updated_at",
        params![input.id, input.url, input.title, input.favicon, folder, note, position, now, now],
    )
    .map_err(|error| error.to_string())?;
    get_bookmark(conn, &input.id)?.ok_or_else(|| "bookmark insert returned no row".into())
}

pub fn list_bookmarks(conn: &Connection, folder: Option<String>) -> Result<Vec<BookmarkRecord>, String> {
    let mut sql = String::from(
        "SELECT id, url, title, favicon, folder, note, position, created_at, updated_at FROM bookmarks",
    );
    let params: Vec<&dyn rusqlite::ToSql> = match folder.as_ref() {
        Some(folder_name) => {
            sql.push_str(" WHERE folder = ?1 ORDER BY position ASC, created_at ASC");
            vec![folder_name as &dyn rusqlite::ToSql]
        }
        None => {
            sql.push_str(" ORDER BY position ASC, created_at ASC");
            vec![]
        }
    };
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params.as_slice(), row_to_record)
        .map_err(|error| error.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|error| error.to_string())?);
    }
    Ok(out)
}

pub fn get_bookmark(conn: &Connection, id: &str) -> Result<Option<BookmarkRecord>, String> {
    let mut stmt = conn
        .prepare("SELECT id, url, title, favicon, folder, note, position, created_at, updated_at FROM bookmarks WHERE id = ?1")
        .map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query_map(params![id], row_to_record)
        .map_err(|error| error.to_string())?;
    match rows.next() {
        Some(row) => Ok(Some(row.map_err(|error| error.to_string())?)),
        None => Ok(None),
    }
}

pub fn delete_bookmark(conn: &Connection, id: &str) -> Result<bool, String> {
    let affected = conn
        .execute("DELETE FROM bookmarks WHERE id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    Ok(affected > 0)
}

pub fn update_bookmark(conn: &Connection, id: &str, patch: BookmarkPatch) -> Result<BookmarkRecord, String> {
    let mut record = get_bookmark(conn, id)?
        .ok_or_else(|| format!("bookmark '{id}' not found"))?;
    if let Some(value) = patch.title { record.title = value; }
    if let Some(value) = patch.folder { record.folder = value; }
    if let Some(value) = patch.note { record.note = value; }
    if let Some(value) = patch.position { record.position = value; }
    if let Some(value) = patch.favicon { record.favicon = Some(value); }
    record.updated_at = now_iso();
    conn.execute(
        "UPDATE bookmarks SET title = ?1, folder = ?2, note = ?4, position = ?5, favicon = ?6, updated_at = ?7 WHERE id = ?3",
        params![record.title, record.folder, record.id, record.note, record.position, record.favicon, record.updated_at],
    )
    .map_err(|error| error.to_string())?;
    Ok(record)
}

pub fn move_bookmark(conn: &Connection, id: &str, folder: &str, position: i64) -> Result<(), String> {
    let updated = conn
        .execute(
            "UPDATE bookmarks SET folder = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
            params![folder, position, now_iso(), id],
        )
        .map_err(|error| error.to_string())?;
    if updated == 0 {
        return Err(format!("bookmark '{id}' not found"));
    }
    Ok(())
}

#[tauri::command]
pub fn bookmark_list(
    app: tauri::AppHandle,
    folder: Option<String>,
) -> Result<Vec<BookmarkRecord>, String> {
    let database = crate::local_store::connection(&app)?;
    list_bookmarks(&database, folder)
}

#[tauri::command]
pub fn bookmark_add(
    app: tauri::AppHandle,
    input: BookmarkInput,
) -> Result<BookmarkRecord, String> {
    let mut database = crate::local_store::connection(&app)?;
    let tx = database.transaction().map_err(|error| error.to_string())?;
    let result = insert_bookmark(&tx, input)?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn bookmark_get(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<BookmarkRecord>, String> {
    let database = crate::local_store::connection(&app)?;
    get_bookmark(&database, &id)
}

#[tauri::command]
pub fn bookmark_remove(
    app: tauri::AppHandle,
    id: String,
) -> Result<bool, String> {
    let mut database = crate::local_store::connection(&app)?;
    let tx = database.transaction().map_err(|error| error.to_string())?;
    let result = delete_bookmark(&tx, &id)?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn bookmark_update(
    app: tauri::AppHandle,
    id: String,
    patch: BookmarkPatch,
) -> Result<BookmarkRecord, String> {
    let mut database = crate::local_store::connection(&app)?;
    let tx = database.transaction().map_err(|error| error.to_string())?;
    let result = update_bookmark(&tx, &id, patch)?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn bookmark_move(
    app: tauri::AppHandle,
    id: String,
    folder: String,
    position: i64,
) -> Result<(), String> {
    let mut database = crate::local_store::connection(&app)?;
    let tx = database.transaction().map_err(|error| error.to_string())?;
    move_bookmark(&tx, &id, &folder, position)?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_store;

    fn fresh_db() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open in-memory db");
        local_store::run_migrations(&mut conn).expect("apply migrations");
        conn
    }

    fn sample_input(id: &str, url: &str, title: &str) -> BookmarkInput {
        BookmarkInput {
            id: id.to_string(),
            url: url.to_string(),
            title: title.to_string(),
            favicon: None,
            folder: None,
            note: None,
        }
    }

    #[test]
    fn insert_rejects_empty_identifier() {
        let conn = fresh_db();
        let mut input = sample_input("", "https://example.com", "Example");
        input.id = String::new();
        let result = insert_bookmark(&conn, input);
        assert!(result.is_err(), "empty id must be rejected");
    }

    #[test]
    fn insert_and_get_round_trips() {
        let conn = fresh_db();
        let record = insert_bookmark(&conn, sample_input("bm-1", "https://example.com", "Example")).expect("insert");
        assert_eq!(record.position, 1);
        let fetched = get_bookmark(&conn, "bm-1").expect("get").expect("present");
        assert_eq!(fetched.url, "https://example.com");
        assert_eq!(fetched.title, "Example");
    }

    #[test]
    fn list_orders_by_position_then_created_at() {
        let conn = fresh_db();
        insert_bookmark(&conn, sample_input("bm-a", "https://a.com", "A")).expect("insert a");
        insert_bookmark(&conn, sample_input("bm-b", "https://b.com", "B")).expect("insert b");
        insert_bookmark(&conn, sample_input("bm-c", "https://c.com", "C")).expect("insert c");
        let list = list_bookmarks(&conn, None).expect("list");
        assert_eq!(list.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["bm-a", "bm-b", "bm-c"]);
    }

    #[test]
    fn update_renames_title_and_note() {
        let conn = fresh_db();
        insert_bookmark(&conn, sample_input("bm-1", "https://x.com", "Old")).expect("insert");
        let mut patch = BookmarkPatch::default();
        patch.title = Some("New".into());
        patch.note = Some("favorite".into());
        let updated = update_bookmark(&conn, "bm-1", patch).expect("update");
        assert_eq!(updated.title, "New");
        assert_eq!(updated.note, "favorite");
    }

    #[test]
    fn delete_removes_record() {
        let conn = fresh_db();
        insert_bookmark(&conn, sample_input("bm-1", "https://x.com", "X")).expect("insert");
        assert!(delete_bookmark(&conn, "bm-1").expect("delete"));
        assert!(get_bookmark(&conn, "bm-1").expect("get").is_none());
    }

    #[test]
    fn move_to_folder_records_position() {
        let conn = fresh_db();
        insert_bookmark(&conn, sample_input("bm-1", "https://x.com", "X")).expect("insert");
        move_bookmark(&conn, "bm-1", "work", 5).expect("move");
        let fetched = get_bookmark(&conn, "bm-1").expect("get").expect("present");
        assert_eq!(fetched.folder, "work");
        assert_eq!(fetched.position, 5);
        let work = list_bookmarks(&conn, Some("work".into())).expect("list work");
        assert_eq!(work.len(), 1);
    }
}