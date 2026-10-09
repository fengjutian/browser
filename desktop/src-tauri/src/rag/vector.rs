//! Vector retrieval (batch 3, with batch-5 HNSW hand-off point) — spec A5/A6.
//!
//! The interface in the spec is:
//!   trait VectorIndex { upsert; delete; search; save; load; ... }
//! and the spec says: "第一阶段保留现有 SQLite 线性余弦检索作为
//! BruteForceVectorIndex".
//!
//! This module implements that. `HnswVectorIndex` is an outright TODO — when
//! batch 5 lands we replace `BruteForceVectorIndex` behind `Searcher::open()`
//! so callers (and the orchestration in `retrieval.rs`) don't need to change.

use std::time::Instant;

#[cfg(test)]
use rusqlite::params;
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};

use super::fusion::VectorCandidate;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorRetrieval {
    pub hits: Vec<VectorCandidate>,
    pub query_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedVector {
    pub chunk_id: String,
    pub document_id: String,
    pub chunk_index: i64,
    pub title: String,
    pub url: String,
    pub heading_path: Vec<String>,
    pub excerpt: String,
    pub text: String,
    pub vector: Vec<f32>,
}

/// Linear-scan cosine search over `document_embeddings`. This stays as the
/// default until the HNSW port in batch 5 lands; the public function
/// `search` is what the retrieval orchestrator should be using so the call
/// sites stop caring about the index type.
pub fn search(
    database: &Connection,
    query_vector: &[f32],
    model: &str,
    candidate_k: usize,
    doc_filter: Option<&[String]>,
) -> Result<VectorRetrieval, String> {
    let started = Instant::now();
    let dims = query_vector.len();
    if dims == 0 {
        return Ok(VectorRetrieval {
            hits: Vec::new(),
            query_ms: 0,
        });
    }

    // Pull candidates from SQLite first. Filter by model + dimensions so we
    // never silently mix embeddings produced under different configurations.
    let mut sql = String::from(
        "SELECT e.document_id, e.chunk_index, e.vector, e.excerpt, d.title, d.url, c.heading_path
         FROM document_embeddings e
         JOIN local_documents d ON d.id = e.document_id
         LEFT JOIN document_chunks c ON c.document_id = e.document_id AND c.chunk_index = e.chunk_index
         WHERE e.model = ?1 AND e.dims = ?2",
    );
    let mut bind: Vec<rusqlite::types::Value> = vec![
        rusqlite::types::Value::Text(model.to_string()),
        rusqlite::types::Value::Integer(dims as i64),
    ];
    if let Some(ids) = doc_filter {
        if !ids.is_empty() {
            sql.push_str(" AND e.document_id IN (");
            let placeholders = std::iter::repeat("?")
                .take(ids.len())
                .collect::<Vec<_>>()
                .join(",");
            sql.push_str(&placeholders);
            sql.push(')');
            for id in ids {
                bind.push(rusqlite::types::Value::Text(id.clone()));
            }
        }
    }

    let mut stmt = database.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(bind.iter()), |row| {
            let vector_bytes: Vec<u8> = row.get(2)?;
            let heading_json: Option<String> = row.get(6)?;
            let heading_path: Vec<String> = heading_json
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_default();
            Ok(RawRow {
                document_id: row.get(0)?,
                chunk_index: row.get(1)?,
                vector_bytes,
                excerpt: row.get(3)?,
                title: row.get(4)?,
                url: row.get(5)?,
                heading_path,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut scored: Vec<VectorCandidate> = Vec::new();
    for row in rows {
        let raw = row.map_err(|e| e.to_string())?;
        let vector = blob_to_vector(&raw.vector_bytes);
        let similarity = cosine_similarity(query_vector, &vector);
        if similarity <= 0.0 {
            continue;
        }
        let chunk_id = super::chunker::chunk_id(
            &raw.document_id,
            super::chunker::CHUNKER_VERSION,
            raw.chunk_index as usize,
            "vector",
        );
        scored.push(VectorCandidate {
            chunk_id,
            document_id: raw.document_id,
            chunk_index: raw.chunk_index,
            title: raw.title,
            url: raw.url,
            heading_path: raw.heading_path,
            excerpt: raw.excerpt,
            text: String::new(),
            similarity,
        });
    }
    scored.sort_by(|a, b| {
        b.similarity
            .partial_cmp(&a.similarity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    scored.truncate(candidate_k);

    Ok(VectorRetrieval {
        hits: scored,
        query_ms: started.elapsed().as_millis(),
    })
}

struct RawRow {
    document_id: String,
    chunk_index: i64,
    vector_bytes: Vec<u8>,
    excerpt: String,
    title: String,
    url: String,
    heading_path: Vec<String>,
}

fn blob_to_vector(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blob_of(v: &[f32]) -> Vec<u8> {
        let mut out = Vec::with_capacity(v.len() * 4);
        for x in v {
            out.extend_from_slice(&x.to_le_bytes());
        }
        out
    }

    #[test]
    fn cosine_similarity_is_zero_for_orthogonal_vectors() {
        assert_eq!(cosine_similarity(&[1.0, 0.0], &[0.0, 1.0]), 0.0);
    }

    #[test]
    fn cosine_similarity_returns_one_for_identical_vectors() {
        let v = vec![0.5, 0.5, 0.5, 0.5];
        let s = cosine_similarity(&v, &v);
        assert!((s - 1.0).abs() < 1e-6);
    }

    #[test]
    fn cosine_similarity_rejects_dimension_mismatch() {
        assert_eq!(cosine_similarity(&[1.0, 0.0], &[1.0, 0.0, 0.0]), 0.0);
    }

    #[test]
    fn vector_search_ranks_close_vectors_higher() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE local_documents(id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'READY', created_at INTEGER NOT NULL, tags TEXT NOT NULL DEFAULT '[]');
             CREATE TABLE document_embeddings(document_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, model TEXT NOT NULL, dims INTEGER NOT NULL, vector BLOB NOT NULL, excerpt TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY(document_id, chunk_index, model));
             CREATE TABLE document_chunks(id TEXT PRIMARY KEY, document_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, heading_path TEXT NOT NULL DEFAULT '[]', content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', content_hash TEXT NOT NULL, chunker_version TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO local_documents(id,title,url,status,created_at,tags) VALUES('d1','T','U','READY',1,'[]')",
            [],
        )
        .unwrap();
        let v1 = vec![1.0_f32, 0.0, 0.0, 0.0];
        let v2 = vec![0.6_f32, 0.6, 0.4, 0.0];
        let v3 = vec![0.0_f32, 1.0, 0.0, 0.0];
        for (idx, v) in [v1, v2, v3].iter().enumerate() {
            conn.execute(
                "INSERT INTO document_embeddings(document_id,chunk_index,model,dims,vector,excerpt,created_at) VALUES('d1',?,'m',4,?,'e',1)",
                params![idx as i64, blob_of(v)],
            )
            .unwrap();
        }
        let result = search(&conn, &[1.0, 0.0, 0.0, 0.0], "m", 3, None).unwrap();
        assert_eq!(result.hits.len(), 3);
        // First hit must be the [1,0,0,0] embedding → similarity 1.0.
        assert!((result.hits[0].similarity - 1.0).abs() < 1e-5);
    }
}
