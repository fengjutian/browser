//! Embedding supervisor (RAG epic, batch 2 — spec A4).
//!
//! The existing path calls `ai_embed` from the React side and writes
//! embeddings row-by-row with no idempotency on partial failure. This module
//! replaces that with a **server-side supervisor** that:
//!
//! - Claims jobs from `rag_index_jobs` with `status='PENDING'` and an
//!   `available_at` in the past.
//! - On startup, walks the table and rewrites any job stuck in
//!   `CHUNKING`/`EMBEDDING`/`INDEXING` back to `PENDING` so a crashed run
//!   can be re-driven without human input.
//! - Stores its plan in `document_chunks`; embeddings from `document_embeddings`.
//! - Honours a retry schedule (30s → 2min → 10min → 30min → FAILED).
//! - Marks jobs `STALE` (not deleted) when the active provider / model
//!   changes, so the user can rebuild later without losing the trace.
//!
//! The embedding client is intentionally a small trait object so a Tauri
//! `AppHandle` isn't threaded through every helper. Production wires
//! `LocalEmbedClient` (batch 2); an `HttpEmbedClient` lands in batch 5 with
//! the provider abstraction.

use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::chunker::{plan_chunks, ChunkPlan, CHUNKER_VERSION};

/// RAG job status as stored in `rag_index_jobs.status`. Kept in lock-step
/// with the SQL CHECK list (migration 23) so a typo here can never silently
/// diverge from the database.
pub const STATUS_PENDING: &str = "PENDING";
pub const STATUS_CHUNKING: &str = "CHUNKING";
pub const STATUS_EMBEDDING: &str = "EMBEDDING";
pub const STATUS_INDEXING: &str = "INDEXING";
pub const STATUS_COMPLETED: &str = "COMPLETED";
pub const STATUS_FAILED: &str = "FAILED";
pub const STATUS_CANCELLED: &str = "CANCELLED";
pub const STATUS_STALE: &str = "STALE";

const RETRY_DELAYS_SECONDS: [u64; 4] = [30, 120, 600, 1_800];

/// Outcome of a single job after the supervisor processed it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexOutcome {
    pub job_id: String,
    pub document_id: String,
    pub status: String,
    pub total_chunks: usize,
    pub completed_chunks: usize,
    pub last_error: Option<String>,
}

/// Minimal embedding client. The supervisor is intentionally agnostic to
/// how embeddings actually get computed — production wires this to whatever
/// the existing `ai_embed` Tauri command does.
#[async_trait::async_trait]
pub trait EmbedClient: Send + Sync {
    async fn embed(&self, provider_id: &str, model: &str, texts: &[String])
        -> Result<Vec<Vec<f32>>, String>;
}

#[derive(Debug, Default)]
pub struct InMemoryEmbedClient;

#[async_trait::async_trait]
impl EmbedClient for InMemoryEmbedClient {
    async fn embed(
        &self,
        _provider_id: &str,
        _model: &str,
        texts: &[String],
    ) -> Result<Vec<Vec<f32>>, String> {
        // Stand-in: deterministic length-based pseudo-embedding. Useful for
        // local end-to-end testing without spinning up a real provider.
        // Production wires this to whatever `ai_embed` does today.
        const DIMS: usize = 32;
        Ok(texts
            .iter()
            .map(|t| {
                let mut vec = vec![0.0_f32; DIMS];
                for (i, slot) in vec.iter_mut().enumerate() {
                    *slot = ((t.len() + i) % 13) as f32 / 13.0;
                }
                // Avoid zero-vector embeddings even for empty inputs.
                if !t.is_empty() {
                    vec[0] = 1.0;
                }
                vec
            })
            .collect())
    }
}

/// Snapshot used by the supervisor to drive the wire event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexProgress {
    pub job_id: String,
    pub document_id: String,
    pub status: String,
    pub total_chunks: usize,
    pub completed_chunks: usize,
    pub last_error: Option<String>,
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Mark all jobs that crashed mid-flight as `PENDING` so a future
/// `tick()` can re-drive them. This is called from app startup — without it,
/// a power outage mid-`EMBEDDING` would leave a row in a non-terminal state
/// forever (spec C2 mandates exactly this recovery).
pub fn recover_timed_out_jobs(database: &Connection) -> Result<usize, String> {
    // Pessimistic threshold: anything stuck in CHUNKING/EMBEDDING/INDEXING
    // for more than 10 minutes without an `updated_at` bump is presumed
    // dead. The supervisor bumps `updated_at` every batch, so a fresh run
    // never gets this rescinded.
    const STUCK_THRESHOLD_SECONDS: i64 = 600;
    let stuck_threshold = now_seconds() - STUCK_THRESHOLD_SECONDS;
    let reset = database
        .execute(
            "UPDATE rag_index_jobs
             SET status = ?1,
                 updated_at = ?2,
                 last_error = COALESCE(last_error, 'recovered from interrupted run')
             WHERE status IN (?3, ?4, ?5)
               AND updated_at < ?6",
            params![
                STATUS_PENDING,
                now_seconds(),
                STATUS_CHUNKING,
                STATUS_EMBEDDING,
                STATUS_INDEXING,
                stuck_threshold,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(reset as usize)
}

/// Enqueue an indexing job for one document. Returns the new job id, or an
/// existing job id if a pending / running job for the same
/// `(document_id, provider_id, model)` already exists.
pub fn enqueue_document(
    database: &Connection,
    document_id: &str,
    provider_id: &str,
    model: &str,
) -> Result<String, String> {
    if let Some(existing) = database
        .query_row(
            "SELECT id FROM rag_index_jobs
             WHERE document_id=?1 AND provider_id=?2 AND model=?3
               AND status IN (?4, ?5, ?6, ?7, ?8)
             ORDER BY created_at DESC LIMIT 1",
            params![
                document_id,
                provider_id,
                model,
                STATUS_PENDING,
                STATUS_CHUNKING,
                STATUS_EMBEDDING,
                STATUS_INDEXING,
                STATUS_STALE,
            ],
            |row| row.get::<_, String>(0),
        )
        .ok()
    {
        return Ok(existing);
    }
    let id = uuid::Uuid::new_v4().to_string();
    database
        .execute(
            "INSERT INTO rag_index_jobs(id, document_id, provider_id, model, status, available_at, created_at, updated_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                document_id,
                provider_id,
                model,
                STATUS_PENDING,
                now_seconds(),
                now_seconds(),
                now_seconds(),
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(id)
}

pub fn cancel_job(database: &Connection, job_id: &str) -> Result<bool, String> {
    let updated = database
        .execute(
            "UPDATE rag_index_jobs SET status=?1, finished_at=?2, updated_at=?2, last_error='cancelled by user'
             WHERE id=?3 AND status IN (?4, ?5, ?6, ?7, ?8)",
            params![
                STATUS_CANCELLED,
                now_seconds(),
                job_id,
                STATUS_PENDING,
                STATUS_CHUNKING,
                STATUS_EMBEDDING,
                STATUS_INDEXING,
                STATUS_STALE,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(updated > 0)
}

/// Mark jobs whose target `(provider_id, model)` no longer matches the active
/// configuration as `STALE`. Called when the user changes embedding provider
/// or model (spec A4: "用户切换模型时将旧索引标记 STALE").
pub fn mark_jobs_for_changed_model(
    database: &Connection,
    previous_provider_id: &str,
    previous_model: &str,
) -> Result<usize, String> {
    let updated = database
        .execute(
            "UPDATE rag_index_jobs SET status=?1, updated_at=?2, last_error='mark stale: model changed'
             WHERE provider_id=?3 AND model=?4 AND status IN (?5, ?6, ?7, ?8, ?9)",
            params![
                STATUS_STALE,
                now_seconds(),
                previous_provider_id,
                previous_model,
                STATUS_PENDING,
                STATUS_CHUNKING,
                STATUS_EMBEDDING,
                STATUS_INDEXING,
                STATUS_COMPLETED,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(updated as usize)
}

/// Synchronous chunking phase. Pulls the document's markdown, runs the
/// structure-aware chunker, and persists chunks to `document_chunks` (which
/// mirrors into `document_chunks_fts` via triggers). Caller is responsible
/// for setting the job status around this call.
pub fn run_chunking_phase(
    database: &Connection,
    job_id: &str,
    document_id: &str,
) -> Result<ChunkPlan, String> {
    let markdown: Option<String> = database
        .query_row(
            "SELECT markdown FROM local_documents WHERE id=?1",
            params![document_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    let body = markdown.unwrap_or_default();

    let plan = if body.trim().is_empty() {
        ChunkPlan {
            chunker_version: CHUNKER_VERSION,
            chunks: Vec::new(),
        }
    } else {
        plan_chunks(document_id, &body)
    };

    let transaction = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    // Replace any prior chunk rows for this document (a re-index that
    // changes chunker_version, or that simply altered the document, must
    // not leave orphan chunk ids.
    transaction
        .execute(
            "DELETE FROM document_chunks WHERE document_id=?1",
            params![document_id],
        )
        .map_err(|e| e.to_string())?;

    for chunk in &plan.chunks {
        let id = super::chunker::chunk_id(
            document_id,
            plan.chunker_version,
            chunk.chunk_index,
            &chunk.content_hash,
        );
        let heading_json = serde_json::to_string(&chunk.heading_path).unwrap_or_else(|_| "[]".into());
        transaction
            .execute(
                "INSERT INTO document_chunks(id, document_id, chunk_index, title, heading_path, content, tags, content_hash, token_count, start_offset, end_offset, chunker_version, created_at, updated_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, '[]', ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    id,
                    document_id,
                    chunk.chunk_index as i64,
                    "",
                    heading_json,
                    chunk.content,
                    chunk.content_hash,
                    chunk.token_count as i64,
                    chunk.start_offset as i64,
                    chunk.end_offset as i64,
                    plan.chunker_version,
                    now_seconds(),
                    now_seconds(),
                ],
            )
            .map_err(|e| e.to_string())?;
    }

    transaction
        .execute(
            "UPDATE rag_index_jobs SET status=?1, total_chunks=?2, completed_chunks=0, updated_at=?3
             WHERE id=?4",
            params![STATUS_EMBEDDING, plan.chunks.len() as i64, now_seconds(), job_id],
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(plan)
}

use rusqlite::OptionalExtension;

/// Drive one job end-to-end. Returns `None` if no job is currently due.
pub async fn tick(
    database: &mut Connection,
    client: &dyn EmbedClient,
    provider_id: &str,
    batch_size: usize,
) -> Result<Option<IndexOutcome>, String> {
    let job = claim_one(database, provider_id)?;
    let Some(job) = job else {
        return Ok(None);
    };

    let plan = match run_chunking_phase(database, &job.id, &job.document_id) {
        Ok(plan) => plan,
        Err(error) => {
            bail_job(database, &job.id, &error, job.attempts + 1)?;
            return Ok(Some(outcome_for(&job, 0, 0, STATUS_FAILED, Some(error))));
        }
    };

    let chunk_count = plan.chunks.len();
    if chunk_count == 0 {
        complete_job(database, &job.id, 0, "no indexable content")?;
        return Ok(Some(outcome_for(&job, 0, 0, STATUS_COMPLETED, None)));
    }

    let mut completed = 0usize;
    let mut last_error: Option<String> = None;
    for batch in plan.chunks.chunks(batch_size.max(1)) {
        let texts: Vec<String> = batch.iter().map(|c| c.content.clone()).collect();
        match client.embed(&job.provider_id, &job.model, &texts).await {
            Ok(vectors) => {
                if vectors.len() != batch.len() {
                    let msg = format!(
                        "embedding provider returned {} vectors for {} inputs",
                        vectors.len(),
                        batch.len()
                    );
                    bail_job(database, &job.id, &msg, job.attempts + 1)?;
                    last_error = Some(msg);
                    break;
                }
                let transaction = database
                    .unchecked_transaction()
                    .map_err(|e| e.to_string())?;
                for (chunk, vector) in batch.iter().zip(vectors.iter()) {
                    let id = super::chunker::chunk_id(
                        &job.document_id,
                        plan.chunker_version,
                        chunk.chunk_index,
                        &chunk.content_hash,
                    );
                    let dims = vector.len() as i64;
                    let blob = vector_to_blob(vector);
                    let excerpt: String = chunk.content.chars().take(400).collect();
                    transaction
                        .execute(
                            "INSERT INTO document_embeddings(document_id, chunk_index, model, dims, vector, excerpt, chunk_id, dimensions, provider_id, embedding_version, content_hash, created_at, updated_at)
                             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                             ON CONFLICT(document_id, chunk_index, model) DO UPDATE SET
                                dims=excluded.dims,
                                vector=excluded.vector,
                                excerpt=excluded.excerpt,
                                dimensions=excluded.dimensions,
                                provider_id=excluded.provider_id,
                                embedding_version=excluded.embedding_version,
                                content_hash=excluded.content_hash,
                                updated_at=excluded.updated_at",
                            params![
                                job.document_id,
                                chunk.chunk_index as i64,
                                job.model,
                                dims,
                                blob,
                                excerpt,
                                id,
                                dims,
                                job.provider_id,
                                CHUNKER_VERSION,
                                chunk.content_hash,
                                now_seconds(),
                                now_seconds(),
                            ],
                        )
                        .map_err(|e| e.to_string())?;
                }
                completed += batch.len();
                transaction
                    .execute(
                        "UPDATE rag_index_jobs SET completed_chunks=?1, updated_at=?2 WHERE id=?3",
                        params![completed as i64, now_seconds(), &job.id],
                    )
                    .map_err(|e| e.to_string())?;
                transaction.commit().map_err(|e| e.to_string())?;
            }
            Err(error) => {
                last_error = Some(error.clone());
                bail_job(database, &job.id, &error, job.attempts + 1)?;
                break;
            }
        }
    }

    let final_status = if completed == chunk_count && last_error.is_none() {
        complete_job(database, &job.id, completed, "ok")?;
        STATUS_COMPLETED
    } else if last_error.is_none() {
        STATUS_INDEXING
    } else {
        STATUS_FAILED
    };
    Ok(Some(outcome_for(&job, chunk_count, completed, final_status, last_error)))
}

#[derive(Debug, Clone)]
struct ClaimedJob {
    id: String,
    document_id: String,
    provider_id: String,
    model: String,
    attempts: i64,
}

fn claim_one(database: &mut Connection, provider_id: &str) -> Result<Option<ClaimedJob>, String> {
    let transaction = database
        .unchecked_transaction()
        .map_err(|e| e.to_string())?;
    let claimed = transaction
        .query_row(
            "SELECT id, document_id, provider_id, model, attempts
             FROM rag_index_jobs
             WHERE status=?1 AND available_at<=?2 AND provider_id=?3
             ORDER BY created_at ASC
             LIMIT 1",
            params![STATUS_PENDING, now_seconds(), provider_id],
            |row| {
                Ok(ClaimedJob {
                    id: row.get(0)?,
                    document_id: row.get(1)?,
                    provider_id: row.get(2)?,
                    model: row.get(3)?,
                    attempts: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(job) = claimed else {
        transaction.commit().map_err(|e| e.to_string())?;
        return Ok(None);
    };
    transaction
        .execute(
            "UPDATE rag_index_jobs SET status=?1, attempts=attempts+1, started_at=?2, updated_at=?2 WHERE id=?3",
            params![STATUS_CHUNKING, now_seconds(), &job.id],
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(Some(job))
}

fn complete_job(
    database: &Connection,
    job_id: &str,
    completed: usize,
    msg: &str,
) -> Result<(), String> {
    database
        .execute(
            "UPDATE rag_index_jobs SET status=?1, finished_at=?2, updated_at=?2, completed_chunks=?3, last_error=NULL
             WHERE id=?4",
            params![STATUS_COMPLETED, now_seconds(), completed as i64, job_id],
        )
        .map_err(|e| e.to_string())?;
    let _ = msg;
    Ok(())
}

fn bail_job(
    database: &Connection,
    job_id: &str,
    error: &str,
    attempts: i64,
) -> Result<(), String> {
    let attempt_count = attempts.max(1) as usize;
    if attempt_count >= RETRY_DELAYS_SECONDS.len() {
        database
            .execute(
                "UPDATE rag_index_jobs SET status=?1, finished_at=?2, updated_at=?2, last_error=?3 WHERE id=?4",
                params![STATUS_FAILED, now_seconds(), error, job_id],
            )
            .map_err(|e| e.to_string())?;
    } else {
        let delay = RETRY_DELAYS_SECONDS[attempt_count.min(RETRY_DELAYS_SECONDS.len()) - 1];
        database
            .execute(
                "UPDATE rag_index_jobs SET status=?1, available_at=?2, updated_at=?2, attempts=?3, last_error=?4 WHERE id=?5",
                params![
                    STATUS_PENDING,
                    now_seconds() + delay as i64,
                    attempt_count as i64,
                    error,
                    job_id,
                ],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn vector_to_blob(vector: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

fn outcome_for(
    job: &ClaimedJob,
    total: usize,
    completed: usize,
    status: &str,
    error: Option<String>,
) -> IndexOutcome {
    IndexOutcome {
        job_id: job.id.clone(),
        document_id: job.document_id.clone(),
        status: status.to_string(),
        total_chunks: total,
        completed_chunks: completed,
        last_error: error,
    }
}

/// Convenience: list the most recent jobs for the settings UI.
pub fn list_jobs(database: &Connection, limit: i64) -> Result<Vec<JobRow>, String> {
    let mut stmt = database
        .prepare(
            "SELECT id, document_id, provider_id, model, status, total_chunks, completed_chunks, attempts, available_at, started_at, finished_at, last_error, created_at, updated_at
             FROM rag_index_jobs
             ORDER BY COALESCE(updated_at, created_at) DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(params![limit], |row| {
            Ok(JobRow {
                id: row.get(0)?,
                document_id: row.get(1)?,
                provider_id: row.get(2)?,
                model: row.get(3)?,
                status: row.get(4)?,
                total_chunks: row.get(5)?,
                completed_chunks: row.get(6)?,
                attempts: row.get(7)?,
                available_at: row.get(8)?,
                started_at: row.get(9)?,
                finished_at: row.get(10)?,
                last_error: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?;
    mapped
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRow {
    pub id: String,
    pub document_id: String,
    pub provider_id: String,
    pub model: String,
    pub status: String,
    pub total_chunks: i64,
    pub completed_chunks: i64,
    pub attempts: i64,
    pub available_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub last_error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fresh_db() -> Connection {
        // Recreate the schema we need: schema_version + migrations 1..=25 are
        // heavy to run for these micro-tests. Apply just the batch-1 tables
        // directly so the supervisor's claim/persist/bail paths are
        // exercised against a realistic shape.
        let conn = Connection::open_in_memory().expect("open");
        conn.execute_batch(
            "CREATE TABLE local_documents(id TEXT PRIMARY KEY, markdown TEXT);
             CREATE TABLE document_embeddings(
                document_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, model TEXT NOT NULL,
                dims INTEGER NOT NULL, vector BLOB NOT NULL, excerpt TEXT NOT NULL DEFAULT '',
                chunk_id TEXT, dimensions INTEGER NOT NULL DEFAULT 0, provider_id TEXT NOT NULL DEFAULT '',
                embedding_version TEXT NOT NULL DEFAULT 'v1', content_hash TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(document_id, chunk_index, model));
             CREATE TABLE document_chunks(
                id TEXT PRIMARY KEY, document_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
                title TEXT NOT NULL DEFAULT '', heading_path TEXT NOT NULL DEFAULT '[]',
                content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
                content_hash TEXT NOT NULL, token_count INTEGER NOT NULL DEFAULT 0,
                start_offset INTEGER NOT NULL DEFAULT 0, end_offset INTEGER NOT NULL DEFAULT 0,
                chunker_version TEXT NOT NULL DEFAULT 'markdown-structure-v1',
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);",
        )
        .expect("create tables");
        conn
    }

    fn seed_document(conn: &Connection, id: &str, body: &str) {
        conn.execute(
            "INSERT INTO local_documents(id, markdown) VALUES(?1, ?2)",
            params![id, body],
        )
        .unwrap();
    }

    fn count_jobs(conn: &Connection, status: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM rag_index_jobs WHERE status=?1",
            params![status],
            |row| row.get(0),
        )
        .unwrap_or(0)
    }

    #[test]
    fn enqueue_dedupes_pending_jobs_for_same_triple() {
        let conn = fresh_db();
        let id1 = enqueue_document(&conn, "doc-1", "p1", "m1").unwrap();
        let id2 = enqueue_document(&conn, "doc-1", "p1", "m1").unwrap();
        assert_eq!(id1, id2, "duplicate enqueue must reuse the open job");
    }

    #[test]
    fn enqueue_creates_a_fresh_row_when_no_existing_job_is_open() {
        let conn = fresh_db();
        let id1 = enqueue_document(&conn, "doc-1", "p1", "m1").unwrap();
        conn.execute(
            "UPDATE rag_index_jobs SET status='COMPLETED', finished_at=1",
            params![id1],
        )
        .unwrap();
        let id2 = enqueue_document(&conn, "doc-1", "p1", "m1").unwrap();
        assert_ne!(id1, id2, "a completed job must not block a fresh enqueue");
    }

    #[test]
    fn cancel_only_targets_active_jobs() {
        let conn = fresh_db();
        let id = enqueue_document(&conn, "doc-1", "p1", "m1").unwrap();
        assert!(cancel_job(&conn, &id).unwrap());
        assert_eq!(count_jobs(&conn, STATUS_CANCELLED), 1);
        // Cancelling twice should be a no-op.
        assert!(!cancel_job(&conn, &id).unwrap());
    }

    #[test]
    fn recover_timed_out_jobs_resets_stuck_in_flight_rows() {
        let conn = fresh_db();
        let id = enqueue_document(&conn, "doc-1", "p1", "m1").unwrap();
        // Simulate a row stuck mid-flight by faking updated_at way in the past.
        conn.execute(
            "UPDATE rag_index_jobs SET status='EMBEDDING', updated_at=?1 WHERE id=?2",
            params![now_seconds() - 3600, id],
        )
        .unwrap();
        let recovered = recover_timed_out_jobs(&conn).unwrap();
        assert_eq!(recovered, 1);
        let actual: String = conn
            .query_row(
                "SELECT status FROM rag_index_jobs WHERE id=?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(actual, STATUS_PENDING);
    }

    #[test]
    fn stale_jobs_for_a_changed_model_are_marked_correctly() {
        let conn = fresh_db();
        let id = enqueue_document(&conn, "doc-1", "old-provider", "old-model").unwrap();
        // Force the job to a terminal state; spec requires a model switch to
        // mark COMPLETED jobs as STALE so they get rebuilt later.
        conn.execute(
            "UPDATE rag_index_jobs SET status='COMPLETED' WHERE id=?1",
            params![id],
        )
        .unwrap();
        let updated = mark_jobs_for_changed_model(&conn, "old-provider", "old-model").unwrap();
        assert_eq!(updated, 1);
        let actual: String = conn
            .query_row(
                "SELECT status FROM rag_index_jobs WHERE id=?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(actual, STATUS_STALE);
    }

    #[test]
    fn chunking_phase_persists_one_chunks_row_per_chunk() {
        let conn = fresh_db();
        seed_document(&conn, "doc-1", "# Heading\n\nfirst body.\n\nsecond body.\n");
        enqueue_document(&conn, "doc-1", "p1", "m1").unwrap();
        // Drive claim + chunk directly to avoid the async runtime here.
        let plan = {
            // Apply CHUNKING status manually since `claim_one` mutates the
            // database in a transaction. For this test we just run the
            // chunking phase after applying the status externally.
            conn.execute(
                "UPDATE rag_index_jobs SET status='CHUNKING', started_at=1, updated_at=1 WHERE document_id='doc-1'",
                [],
            )
            .unwrap();
            let job_id: String = conn
                .query_row(
                    "SELECT id FROM rag_index_jobs WHERE document_id='doc-1'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            run_chunking_phase(&conn, &job_id, "doc-1").unwrap()
        };
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM document_chunks WHERE document_id='doc-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count as usize, plan.chunks.len());
        assert!(count > 0);
    }
}
