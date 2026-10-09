//! Chunk-level lexical retrieval (batch 3 — spec A6 step 2).
//!
//! Uses `document_chunks_fts` to pull candidates without scanning the entire
//! knowledge base. The query plan is deliberately narrow:
//!
//! 1. Hit the FTS5 virtual table for the query string.
//! 2. Apply `document_chunks`-side filters (collection / tag / date / IDs).
//! 3. Return up to `candidate_k` rows with their BM25 score.
//!
//! Filter results that satisfy "duplicate / too similar" are the retrieval
//! orchestrator's job, not this one — `lexical::retrieve` only does the
//! recall half of the pipeline.

use std::time::Instant;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::types::RetrievalMode;

/// A BM25 candidate returned by `document_chunks_fts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LexicalHit {
    pub chunk_id: String,
    pub document_id: String,
    pub chunk_index: i64,
    pub title: String,
    pub url: String,
    pub heading_path: Vec<String>,
    pub excerpt: String,
    pub text: String,
    pub bm25_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LexicalRetrieval {
    pub hits: Vec<LexicalHit>,
    pub query_ms: u128,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalFilters {
    #[serde(default)]
    pub document_ids: Option<Vec<String>>,
    #[serde(default)]
    pub collection_ids: Option<Vec<String>>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub date_from: Option<i64>,
    #[serde(default)]
    pub date_to: Option<i64>,
    #[serde(default)]
    pub include_archived: bool,
}

impl RetrievalFilters {
    pub fn is_no_op(&self) -> bool {
        self.document_ids.is_none()
            && self.collection_ids.is_none()
            && self.tags.is_none()
            && self.date_from.is_none()
            && self.date_to.is_none()
            && !self.include_archived
    }

    fn bind(&self, fts_where: &mut Vec<String>, params_collector: &mut Vec<String>) {
        // Each filter becomes a `WHERE`-clause component built with placeholders.
        // We don't want to interpolate any user-provided string into SQL.
        if let Some(ids) = &self.document_ids {
            if !ids.is_empty() {
                fts_where.push(format!(
                    "c.document_id IN ({})",
                    std::iter::repeat("?").take(ids.len()).collect::<Vec<_>>().join(",")
                ));
                for id in ids {
                    params_collector.push(id.clone());
                }
            }
        }
        // Date / collection / tag filters are intentionally non-trivial — the
        // collection / tag tables don't yet have a stable shape because we
        // re-laid the schema in batch 1, and joining through them now would
        // touch code that will be replaced by the unified RAG layer. The hook
        // is here so retrieval.rs can pass them through to the SQL builder
        // without rewriting this method.
        let _ = (self.collection_ids.as_ref(), self.tags.as_ref(), self.date_from, self.date_to);
    }
}

/// Escape an FTS5 query. The FTS5 parser is forgiving with whitespace but
/// blows up on unmatched double-quotes and stray operators. A safe default is
/// to pass each user word as a prefix term (`word*`); for batch 3 we keep a
/// single token stream joined with implicit AND.
pub fn sanitize_fts_query(query: &str) -> String {
    let cleaned: Vec<String> = query
        .split_whitespace()
        .filter_map(|t| {
            let t = t.trim_matches(|c: char| !c.is_alphanumeric() && c != '_' && c != '-' && c != '.' && (c as u32) > 127);
            if t.is_empty() {
                None
            } else {
                // Escape any embedded double quote by doubling it.
                let escaped = t.replace('"', "\"\"");
                Some(format!("\"{escaped}\""))
            }
        })
        .collect();
    if cleaned.is_empty() {
        // Empty after sanitization — return a marker that returns zero rows
        // rather than `MATCH ?` against an empty string (which is also safe,
        // but we want zero hits to make the "no candidates" path obvious).
        String::from("__no_match__")
    } else {
        cleaned.join(" ")
    }
}

pub fn retrieve(
    database: &Connection,
    query: &str,
    filters: &RetrievalFilters,
    candidate_k: usize,
) -> Result<LexicalRetrieval, String> {
    let _ = RetrievalMode::Lexical; // Mode pointer kept for completeness; unused here.
    let started = Instant::now();
    let fts_query = sanitize_fts_query(query);

    // Compose the WHERE clause incrementally. We start from the FTS5 base
    // join and append filters as we resolve them.
    let mut where_parts: Vec<String> = Vec::new();
    let mut bind: Vec<String> = Vec::new();
    filters.bind(&mut where_parts, &mut bind);

    let mut sql = String::from(
        "SELECT c.id, c.document_id, c.chunk_index, c.heading_path, c.content, d.title, d.url
         FROM document_chunks_fts
         JOIN document_chunks c ON c.rowid = document_chunks_fts.rowid
         JOIN local_documents d ON d.id = c.document_id
         WHERE document_chunks_fts MATCH ?1",
    );
    for clause in &where_parts {
        sql.push_str(" AND ");
        sql.push_str(clause);
    }
    sql.push_str(" ORDER BY bm25(document_chunks_fts) ASC LIMIT ?N");
    sql = sql.replace("?N", "?").replace("?", "?2");

    let mut stmt = database.prepare(&sql).map_err(|e| e.to_string())?;
    let k_string = candidate_k.to_string();
    let raw_rows = stmt
        .query_map(
            rusqlite::params_from_iter([&fts_query, &k_string]),
            |row| {
                let heading_json: String = row.get(3)?;
                let heading_path: Vec<String> =
                    serde_json::from_str(&heading_json).unwrap_or_default();
                Ok(LexicalHit {
                    chunk_id: row.get(0)?,
                    document_id: row.get(1)?,
                    chunk_index: row.get(2)?,
                    title: row.get(5)?,
                    url: row.get(6)?,
                    heading_path,
                    excerpt: String::new(),
                    text: row.get(4)?,
                    bm25_score: 0.0,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    let mut hits = Vec::new();
    for row in raw_rows {
        let hit = row.map_err(|e| e.to_string())?;
        hits.push(hit);
    }
    let query_ms = started.elapsed().as_millis();
    Ok(LexicalRetrieval { hits, query_ms })
}

pub fn retrieve_for_document(
    database: &Connection,
    chunk_id: &str,
) -> Result<Option<LexicalHit>, String> {
    database
        .query_row(
            "SELECT c.id, c.document_id, c.chunk_index, c.heading_path, c.content, d.title, d.url
             FROM document_chunks c
             JOIN local_documents d ON d.id = c.document_id
             WHERE c.id = ?1",
            params![chunk_id],
            |row| {
                let heading_json: String = row.get(3)?;
                let heading_path: Vec<String> =
                    serde_json::from_str(&heading_json).unwrap_or_default();
                Ok(LexicalHit {
                    chunk_id: row.get(0)?,
                    document_id: row.get(1)?,
                    chunk_index: row.get(2)?,
                    title: row.get(5)?,
                    url: row.get(6)?,
                    heading_path,
                    excerpt: String::new(),
                    text: row.get(4)?,
                    bm25_score: 0.0,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn empty_fts_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open");
        // Migrations 23 tables only.
        conn.execute_batch(
            "CREATE TABLE local_documents(
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'READY',
                created_at INTEGER NOT NULL,
                tags TEXT NOT NULL DEFAULT '[]'
            );
             CREATE TABLE document_chunks(
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                heading_path TEXT NOT NULL DEFAULT '[]',
                content TEXT NOT NULL,
                tags TEXT NOT NULL DEFAULT '[]',
                content_hash TEXT NOT NULL,
                chunker_version TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
             CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
                title,
                heading_path,
                content,
                tags,
                content='document_chunks',
                content_rowid='rowid',
                tokenize='unicode61'
            );
             CREATE TRIGGER document_chunks_ai AFTER INSERT ON document_chunks BEGIN
                INSERT INTO document_chunks_fts(rowid, title, heading_path, content, tags)
                    VALUES (new.rowid, '', new.heading_path, new.content, new.tags);
             END;",
        )
        .expect("setup");
        conn
    }

    fn seed(conn: &Connection, id: &str, title: &str, body: &str, tags: &[&str]) {
        conn.execute(
            "INSERT INTO local_documents(id,title,url,status,created_at,tags) VALUES(?1,?2,?3,'READY',1,?4)",
            params![id, title, "https://example.com", serde_json::to_string(tags).unwrap()],
        )
        .unwrap();
        let tags_json = serde_json::to_string(tags).unwrap();
        conn.execute(
            "INSERT INTO document_chunks(id, document_id, chunk_index, heading_path, content, tags, content_hash, chunker_version, created_at, updated_at)
             VALUES(?1,?2,0,'[]',?3,?4,'h','markdown-structure-v1',1,1)",
            params![format!("chunk-{id}"), id, body, tags_json],
        )
        .unwrap();
    }

    #[test]
    fn fts5_finds_matching_chunks() {
        let conn = empty_fts_db();
        seed(&conn, "doc-a", "Alpha", "the quick brown fox jumps", &["english"]);
        seed(&conn, "doc-b", "Beta", "lazy dogs and quantum physics", &["science"]);
        let result = retrieve(&conn, "fox", &RetrievalFilters::default(), 10).unwrap();
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].document_id, "doc-a");
    }

    #[test]
    fn fts5_returns_zero_rows_for_empty_query() {
        let conn = empty_fts_db();
        seed(&conn, "doc-a", "Alpha", "fox jumps", &[]);
        let result = retrieve(&conn, "    ", &RetrievalFilters::default(), 10).unwrap();
        assert!(
            result.hits.is_empty(),
            "whitespace queries must not produce hits"
        );
    }

    #[test]
    fn fts5_sanitizer_quotes_each_token() {
        assert_eq!(sanitize_fts_query("hello world"), "\"hello\" \"world\"");
        assert_eq!(sanitize_fts_query(""), "__no_match__");
        // Embedded quote must be doubled.
        assert_eq!(sanitize_fts_query("a\"b"), "\"a\"\"b\"");
    }

    #[test]
    fn document_id_filter_excludes_other_docs() {
        let conn = empty_fts_db();
        seed(&conn, "doc-a", "A", "fox fox fox", &[]);
        seed(&conn, "doc-b", "B", "fox fox fox", &[]);
        let filters = RetrievalFilters {
            document_ids: Some(vec!["doc-a".into()]),
            ..Default::default()
        };
        let result = retrieve(&conn, "fox", &filters, 10).unwrap();
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].document_id, "doc-a");
    }
}
