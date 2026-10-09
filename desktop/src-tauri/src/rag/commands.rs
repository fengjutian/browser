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

use tauri::AppHandle;

use crate::local_store;

use super::indexer::{cancel_job, enqueue_document, list_jobs, recover_timed_out_jobs, JobRow};
use super::retrieval::RagRetrieveResponse;
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

// ---------------------------------------------------------------------------
// rag_answer — real LLM-backed answer with citation validation + 1 repair pass.
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RagAnswerRequest {
    pub provider_id: String,
    pub query: RagQuery,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    /// Skip the second (repair) call even if validation fails. Used by tests.
    #[serde(default)]
    pub skip_repair: bool,
}

/// Build the system prompt that asks the model to write an answer
/// interleaved with `[SOURCE id="doc:..."]...[/SOURCE]` citation blocks.
fn build_answer_prompt(retrieval: &RagRetrieveResponse) -> String {
    let mut s = String::new();
    s.push_str("你是一个严格的助理,只能基于提供的资料回答问题。\n");
    s.push_str("If the sources do not contain the answer, reply exactly with: 我不知道 (or in English: I don't know).\n");
    s.push_str(
        "Every claim that is not a refusal MUST be followed by a citation block in the form:\n",
    );
    s.push_str("  [SOURCE id=\"doc:<document_id>:chunk:<index>\"]\n  <quoted or paraphrased excerpt>\n  [/SOURCE]\n");
    s.push_str("Use the exact id strings from the evidence list. Do not invent new ids.\n\n");
    s.push_str("Evidence pack (do not reference anything outside this list):\n");
    for (i, hit) in retrieval.hits.iter().enumerate() {
        s.push_str(&format!(
            "[{}] id={} document_id={} title={:?} url={:?}\n{}\n---\n",
            i + 1,
            hit.chunk.chunk_id,
            hit.chunk.document_id,
            hit.chunk.title,
            hit.chunk.url,
            hit.chunk.text
        ));
    }
    s
}

/// Build the repair prompt that asks the model to fix citations that
/// reference ids not in the evidence pack.
fn build_repair_prompt(answer: &str, retrieval: &RagRetrieveResponse) -> String {
    let mut s = String::new();
    s.push_str("Your previous answer contained citations that are not in the evidence pack.\n");
    s.push_str("Rewrite the answer so every citation is one of the ids below. If the answer\n");
    s.push_str("cannot be supported, reply with: 我不知道.\n\n");
    s.push_str("Valid ids:\n");
    for hit in retrieval.hits.iter() {
        s.push_str(&format!("- {}\n", hit.chunk.chunk_id));
    }
    s.push_str("\nPrevious answer:\n");
    s.push_str(answer);
    s.push_str("\n\nRewrite the answer now, keeping its content where it can be supported by the valid ids.\n");
    s
}

#[tauri::command]
pub async fn rag_answer(
    app: AppHandle,
    request: RagAnswerRequest,
) -> Result<super::citation::RagAnswer, String> {
    if request.provider_id.trim().is_empty() {
        return Err("provider_id is required".into());
    }
    // 1) Evidence pack
    let mut query = request.query.clone();
    if query.provider_id.is_none() {
        query.provider_id = Some(request.provider_id.clone());
    }
    let retrieval = rag_retrieve(app.clone(), request.provider_id.clone(), query).await?;

    let candidate_ids: Vec<String> = retrieval
        .hits
        .iter()
        .map(|h| h.chunk.chunk_id.clone())
        .collect();

    // 2) Build provider (mirrors `ai_chat`'s dispatch table).
    let database = local_store::connection(&app)?;
    let (provider_type, base_url, model, timeout_seconds): (String, String, String, i64) = database
        .prepare("SELECT provider_type,base_url,model,timeout_seconds FROM ai_providers WHERE id=?")
        .map_err(|e| e.to_string())?
        .query_row(rusqlite::params![request.provider_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(|e| e.to_string())?;
    let timeout = std::time::Duration::from_secs(timeout_seconds.clamp(1, 600) as u64);
    let api_key = keyring::Entry::new(crate::KEYRING_SERVICE, &request.provider_id)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|value| !value.is_empty());
    let provider: Box<dyn crate::providers::AiProvider> = match provider_type.as_str() {
        "openai-compatible" | "deepseek" | "qwen" | "kimi" | "minimax" => {
            Box::new(crate::providers::openai::OpenAICompatibleProvider {
                base_url,
                model,
                api_key: api_key.clone(),
                timeout,
            })
        }
        "ollama" => Box::new(crate::providers::ollama::OllamaProvider {
            base_url,
            model,
            timeout,
        }),
        other => return Err(format!("unknown provider type: {other}")),
    };
    if provider.type_id() == "openai-compatible" && api_key.is_none() {
        return Err("missing api key for openai-compatible provider".into());
    }

    let system_prompt = build_answer_prompt(&retrieval);
    let user_query = request.query.query.clone();

    // 3) First pass
    let chat_request = crate::providers::ChatRequest {
        messages: vec![
            crate::providers::ChatMessage {
                role: "system".into(),
                content: system_prompt.clone(),
            },
            crate::providers::ChatMessage {
                role: "user".into(),
                content: user_query.clone(),
            },
        ],
        temperature: request.temperature.or(Some(0.2)),
        max_tokens: request.max_tokens.or(Some(1024)),
    };
    let first = provider
        .chat(chat_request)
        .await
        .map_err(|e| e.to_string())?;
    let mut current_answer = first.content.clone();
    let mut validated =
        super::citation::validate_answer(&current_answer, &retrieval, &candidate_ids);

    // 4) Repair pass — at most one. Triggered when validation finds
    //    unsupported ids or uncovered paragraphs.
    if !request.skip_repair
        && (matches!(
            validated.citation_status,
            super::citation::CitationStatus::Invalid
        ) || matches!(
            validated.citation_status,
            super::citation::CitationStatus::Partial
        ))
    {
        let repair_prompt = build_repair_prompt(&current_answer, &retrieval);
        let repair_request = crate::providers::ChatRequest {
            messages: vec![
                crate::providers::ChatMessage {
                    role: "system".into(),
                    content: system_prompt.clone(),
                },
                crate::providers::ChatMessage {
                    role: "user".into(),
                    content: repair_prompt,
                },
            ],
            temperature: Some(0.1),
            max_tokens: request.max_tokens.or(Some(1024)),
        };
        if let Ok(second) = provider.chat(repair_request).await {
            current_answer = second.content;
            validated =
                super::citation::validate_answer(&current_answer, &retrieval, &candidate_ids);
        }
    }

    Ok(validated)
}

/// Run the full retrieval pipeline (spec A6). Embedding is plugged in via
/// `query.provider_id`; we look up the active provider's base_url, key
/// (from the OS keyring) and embedding model, then call the shared
/// `providers::embedding::embed_for_provider`. If the provider cannot be
/// reached, hybrid mode degrades to lexical-only and the response carries
/// a warning; vector-only mode returns empty hits with the same warning
/// so the UI can distinguish "no answer" from "vector outage".
#[tauri::command]
pub async fn rag_retrieve(
    app: AppHandle,
    provider_id: String,
    query: RagQuery,
) -> Result<RagRetrieveResponse, String> {
    if provider_id.trim().is_empty() {
        return Err("provider_id is required".into());
    }
    let mut query = query;
    if query.provider_id.is_none() {
        query.provider_id = Some(provider_id.clone());
    }
    // Wrap the connection in an `Arc<tokio::sync::Mutex>` so the
    // `ProviderEmbedder` future is `Send` (rusqlite `Connection` is `!Sync`).
    let database = {
        let conn = local_store::connection(&app)?;
        std::sync::Arc::new(tokio::sync::Mutex::new(conn))
    };
    let embedder = super::retrieval::ProviderEmbedder {
        database: database.clone(),
        provider_id,
    };
    super::retrieval::orchestrate_with_embedder(&query, database, &embedder).await
}
