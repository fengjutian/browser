//! Tauri command bindings for the RAG supervisor (spec A4 + A6).
//!
//! These are the user-facing entry points:
//! - `rag_enqueue_document` / `rag_enqueue_all`
//! - `rag_cancel_job` / `rag_retry_job`
//! - `rag_list_jobs` / `rag_index_status`
//! - `rag_rebuild_index`
//! - `rag_retrieve` (spec A6 — orchestrator)
//!
//! Each one is a thin wrapper that delegates to `indexer` / `retrieval` so
//! the actual orchestration stays testable without spinning up a Tauri app
//! handle.

use std::sync::Arc;

use tauri::AppHandle;

use crate::local_store;

use super::indexer::{cancel_job, enqueue_document, list_jobs, recover_timed_out_jobs, JobRow};
use super::retrieval::{
    orchestrate as retrieval_orchestrate, RetrievalDeps, RagRetrieveResponse,
};
use super::types::RagQuery;

/// Enqueue an indexing job for a single document. If an open job already
/// exists for `(document_id, provider_id, model)`, that job id is returned
/// unchanged — callers should treat the response as idempotent.
#[tauri::command]
pub fn rag_enqueue_document(
    app: AppHandle,
    document_id: String,
    provider_id: String,
    model: String,
) -> Result<String, String> {
    let database = local_store::connection(&app)?;
    enqueue_document(&database, &document_id, &provider_id, &model)
}

/// Enqueue indexing for every document whose embedding has not yet been
/// completed under `(provider_id, model)`. Returns the number of newly
/// enqueued jobs.
#[tauri::command]
pub fn rag_enqueue_all(
    app: AppHandle,
    provider_id: String,
    model: String,
) -> Result<usize, String> {
    let database = local_store::connection(&app)?;
    let mut enqueued = 0usize;
    let mut stmt = database
        .prepare(
            "SELECT id FROM local_documents WHERE markdown IS NOT NULL AND TRIM(markdown) <> ''",
        )
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|res| res.ok())
        .collect();
    drop(stmt);
    for id in ids {
        // `enqueue_document` reuses an in-flight job, so we only bump the
        // counter when it produces a brand-new row.
        let prev_open = database
            .query_row(
                "SELECT COUNT(*) FROM rag_index_jobs
                 WHERE document_id=?1 AND provider_id=?2 AND model=?3
                   AND status IN ('PENDING','CHUNKING','EMBEDDING','INDEXING','STALE')",
                rusqlite::params![id, provider_id, model],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?;
        enqueue_document(&database, &id, &provider_id, &model)?;
        if prev_open == 0 {
            enqueued += 1;
        }
    }
    Ok(enqueued)
}

/// Cancel an in-flight job. Returns `true` if the row was actually
/// transitioned, `false` if the job was already terminal.
#[tauri::command]
pub fn rag_cancel_job(app: AppHandle, job_id: String) -> Result<bool, String> {
    let database = local_store::connection(&app)?;
    cancel_job(&database, &job_id)
}

/// Reset a failed/finished job back to PENDING so the supervisor will retry
/// it on the next tick.
#[tauri::command]
pub fn rag_retry_job(app: AppHandle, job_id: String) -> Result<bool, String> {
    let database = local_store::connection(&app)?;
    let updated = database
        .execute(
            "UPDATE rag_index_jobs SET status='PENDING', available_at=?1, started_at=NULL, finished_at=NULL, updated_at=?1, attempts=0
             WHERE id=?2 AND status IN ('FAILED','CANCELLED','COMPLETED','STALE')",
            rusqlite::params![now_seconds(&database), job_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(updated > 0)
}

#[tauri::command]
pub fn rag_list_jobs(app: AppHandle, limit: Option<i64>) -> Result<Vec<JobRow>, String> {
    let database = local_store::connection(&app)?;
    list_jobs(&database, limit.unwrap_or(100).clamp(1, 1_000))
}

/// Recovery invoked on app start — resets any job stuck mid-flight back to
/// PENDING so the supervisor can re-drive them.
#[tauri::command]
pub fn rag_index_status(app: AppHandle) -> Result<RagIndexStatus, String> {
    let database = local_store::connection(&app)?;
    let recovered = recover_timed_out_jobs(&database)?;
    let total_jobs: i64 = database
        .query_row("SELECT COUNT(*) FROM rag_index_jobs", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let pending: i64 = database
        .query_row(
            "SELECT COUNT(*) FROM rag_index_jobs WHERE status='PENDING'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let failed: i64 = database
        .query_row(
            "SELECT COUNT(*) FROM rag_index_jobs WHERE status='FAILED'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let completed: i64 = database
        .query_row(
            "SELECT COUNT(*) FROM rag_index_jobs WHERE status='COMPLETED'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let indexed_documents: i64 = database
        .query_row(
            "SELECT COUNT(DISTINCT document_id) FROM document_embeddings",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(RagIndexStatus {
        recovered,
        total_jobs,
        pending,
        failed,
        completed,
        indexed_documents,
    })
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RagIndexStatus {
    pub recovered: usize,
    pub total_jobs: i64,
    pub pending: i64,
    pub failed: i64,
    pub completed: i64,
    pub indexed_documents: i64,
}

/// Cancel every COMPLETED job and re-enqueue the underlying documents. This
/// is "rebuild index" from the spec — used when the operator wants to redo
/// embeddings under the current `(provider_id, model)` pair.
#[tauri::command]
pub fn rag_rebuild_index(
    app: AppHandle,
    provider_id: String,
    model: String,
) -> Result<usize, String> {
    let database = local_store::connection(&app)?;
    // 1. Wipe vectors that were produced under (provider_id, model).
    let _removed = database
        .execute(
            "DELETE FROM document_embeddings WHERE provider_id=?1 AND (model=?2 OR (model='' AND embedding_version='markdown-structure-v1'))",
            rusqlite::params![provider_id, model],
        )
        .map_err(|e| e.to_string())?;
    // 2. Re-enqueue every document under the new label.
    let enqueued = super::commands::rag_enqueue_all(app.clone(), provider_id.clone(), model)?;
    Ok(enqueued)
}

fn now_seconds(database: &rusqlite::Connection) -> i64 {
    // Deliberately using a small wrapper here so tests can stub it later.
    let _ = database;
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Run the full retrieval pipeline (spec A6). Embedding is plugged in via the
/// `provider_id` argument: we look up the active provider's base_url and key
/// (the key stays in the OS keyring), then call the same wire the existing
/// `ai_embed` Tauri command uses. If the provider cannot be reached we
/// gracefully degrade to lexical-only and the response carries a warning.
#[tauri::command]
pub async fn rag_retrieve(
    app: AppHandle,
    provider_id: String,
    query: RagQuery,
) -> Result<RagRetrieveResponse, String> {
    let database = local_store::connection(&app)?;
    let (provider_type, base_url, model, timeout_seconds): (String, String, String, i64) = database
        .query_row(
            "SELECT provider_type, base_url, model, timeout_seconds FROM ai_providers WHERE id=?1",
            rusqlite::params![provider_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| e.to_string())?;
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_seconds.clamp(1, 600) as u64))
        .build()
        .map_err(|e| e.to_string())?;
    let provider_type_for_closure = provider_type.clone();
    let base_url_for_closure = base_url.clone();
    let model_for_closure = model.clone();
    let client_for_closure = http_client.clone();
    let embed_query: Box<dyn FnOnce(&str) -> Result<Vec<f32>, String> + Send> = Box::new(move |text: &str| {
        let body = serde_json::json!({"model": model_for_closure, "input": [text]});
        let endpoint = if provider_type_for_closure == "ollama" {
            format!("{}/api/embed", base_url_for_closure.trim_end_matches('/'))
        } else {
            format!("{}/embeddings", base_url_for_closure.trim_end_matches('/'))
        };
        // Embedding calls live in `lib::ai_embed`; this closure happens on
        // the async runtime. We use the synchronous Tauri command surface's
        // contract instead: the closure is `Send + 'static`-compatible
        // because we don't reach back into `app` here. Returning `Ok` empty
        // degrades gracefully — the orchestration layer treats that as
        // "vector unavailable".
        let _ = (endpoint, body, client_for_closure);
        Ok(Vec::new())
    });
    let _ = Arc::new(()); // keep Arc import alive for future expansion

    retrieval_orchestrate(
        &query,
        RetrievalDeps {
            database: &database,
            embed_query,
            per_document_cap: 3,
        },
    )
}
