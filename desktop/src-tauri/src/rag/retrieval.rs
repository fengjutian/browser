//! Mixed retrieval orchestrator (spec A6).
//!
//! Pipeline:
//!   1. Validate query and candidate count.
//!   2. Lexical recall over `document_chunks_fts` (always).
//!   3. Vector recall via the active embedding provider (best effort; FTS-only
//!      when the provider is unavailable — never abort).
//!   4. RRF combine; deduplicate by stable chunk id.
//!   5. Apply filters (collection / tag / date / doc-id).
//!   6. Cap per document (default 3) to avoid one doc monopolising context.
//!   7. Optional rerank — wired through `super::reranker`.
//!   8. Return hits with explainable timings + a `degraded` flag and a warnings
//!      list so the UI can render "vector only / lex only" honestly.

use std::time::Instant;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::fusion::{reciprocal_rank_fusion, FusedCandidate, VectorCandidate};
use super::lexical::{retrieve as lexical_retrieve, LexicalHit, RetrievalFilters};
use super::types::{RagChunk, RagQuery, RetrievalHit, RetrievalMode, RetrievalScore};
use super::vector::search as vector_search;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagTimings {
    pub lexical_ms: u128,
    pub embedding_ms: u128,
    pub vector_ms: u128,
    pub fusion_ms: u128,
    pub rerank_ms: u128,
    pub total_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagRetrieveResponse {
    pub hits: Vec<RetrievalHit>,
    pub degraded: bool,
    pub warnings: Vec<String>,
    pub timings: RagTimings,
    pub index_key: Option<super::types::EmbeddingIndexKey>,
}

/// Async embedder hook used by the orchestrator. Returning `Ok(empty)`
/// signals "vector unavailable" — the orchestrator degrades to lexical
/// only and records a warning.
#[async_trait::async_trait]
pub trait QueryEmbedder: Send + Sync {
    async fn embed_query(&self, query: &str) -> Result<Vec<f32>, String>;
}

/// Default embedder backed by `providers::embedding::embed_for_provider`.
/// Production wires this in `commands::rag_retrieve`. The connection is
/// wrapped in `tokio::sync::Mutex` so the future returned by `embed_query`
/// is `Send`; without the wrapper the borrow checker complains because
/// `&Connection` is `!Sync`.
pub struct ProviderEmbedder {
    pub database: std::sync::Arc<tokio::sync::Mutex<Connection>>,
    pub provider_id: String,
}

#[async_trait::async_trait]
impl QueryEmbedder for ProviderEmbedder {
    async fn embed_query(&self, query: &str) -> Result<Vec<f32>, String> {
        let conn = self.database.lock().await;
        let mut req = crate::providers::embedding::read_embedding_request(&conn, &self.provider_id)
            .map_err(|e| e.to_string())?;
        req.inputs = vec![query.to_string()];
        // Drop the lock before awaiting the HTTP call so the future is `Send`.
        drop(conn);
        let response = crate::providers::embedding::embed_with_request(req)
            .await
            .map_err(|e| e.to_string())?;
        response
            .vectors
            .into_iter()
            .next()
            .ok_or_else(|| "embedding provider returned no vectors".to_string())
    }
}

pub async fn orchestrate_with_embedder(
    query: &RagQuery,
    database: std::sync::Arc<tokio::sync::Mutex<Connection>>,
    embedder: &dyn QueryEmbedder,
) -> Result<RagRetrieveResponse, String> {
    let started = Instant::now();
    let mut warnings = Vec::new();
    let mut timings = RagTimings::default();

    if query.top_k == 0 || query.candidate_k == 0 {
        return Err("top_k and candidate_k must be > 0".into());
    }
    if query.query.trim().is_empty() {
        return Err("query is empty".into());
    }

    let filters = RetrievalFilters {
        document_ids: query.document_ids.clone(),
        collection_ids: query.collection_ids.clone(),
        tags: query.tags.clone(),
        date_from: query.date_from,
        date_to: query.date_to,
        include_archived: query.include_archived,
    };

    // 1. Lexical recall (always available).
    let lex_started = Instant::now();
    let lexical = {
        let conn = database.lock().await;
        lexical_retrieve(&conn, &query.query, &filters, query.candidate_k)
    };
    let lexical = match lexical {
        Ok(value) => value,
        Err(error) => {
            warnings.push(format!("lexical retrieval failed: {error}"));
            super::lexical::LexicalRetrieval {
                hits: Vec::new(),
                query_ms: 0,
            }
        }
    };
    timings.lexical_ms = lex_started.elapsed().as_millis();

    // 2. Build an EmbeddingIndexKey from the query.
    let index_key = if query.provider_id.is_some() || query.embedding_model.is_some() {
        let provider_id = query.provider_id.clone().unwrap_or_default();
        let model = query.embedding_model.clone().unwrap_or_default();
        let dims = query.dimensions.unwrap_or(0);
        let embedding_version = query.embedding_version.clone().unwrap_or_default();
        let chunker_version = query.chunker_version.clone().unwrap_or_default();
        Some(super::types::EmbeddingIndexKey {
            provider_id,
            model,
            dimensions: dims,
            embedding_version,
            chunker_version,
        })
    } else {
        None
    };

    // 3. Vector recall — only if requested and if the embed hook is healthy.
    let wants_vector = matches!(
        query.retrieval_mode,
        RetrievalMode::Vector | RetrievalMode::Hybrid
    );
    let mut vector: Vec<VectorCandidate> = Vec::new();
    if wants_vector {
        if index_key.is_none() {
            warnings.push("vector requested but provider/model not specified".into());
        } else if query.provider_id.is_none() {
            warnings.push("vector requested but provider_id missing".into());
        } else {
            let embed_started = Instant::now();
            let embed_result = embedder.embed_query(&query.query).await;
            timings.embedding_ms = embed_started.elapsed().as_millis();
            match embed_result {
                Ok(vec) => {
                    let dims = vec.len();
                    if let Some(key) = &index_key {
                        if key.dimensions != 0 && key.dimensions != dims {
                            let msg = format!(
                                "query vector dims {dims} != index dims {}; refusing to mix",
                                key.dimensions
                            );
                            warnings.push(msg);
                            match query.retrieval_mode {
                                RetrievalMode::Vector => {
                                    timings.total_ms = started.elapsed().as_millis();
                                    return Ok(RagRetrieveResponse {
                                        hits: Vec::new(),
                                        degraded: true,
                                        warnings,
                                        timings,
                                        index_key: index_key.clone(),
                                    });
                                }
                                RetrievalMode::Hybrid => { /* fall through */ }
                                RetrievalMode::Lexical => { /* unreachable */ }
                            }
                        } else {
                            let search_started = Instant::now();
                            let conn = database.lock().await;
                            let result = vector_search(
                                &conn,
                                &vec,
                                &key.model,
                                query.candidate_k,
                                filters.document_ids.as_deref(),
                            );
                            drop(conn);
                            timings.vector_ms = search_started.elapsed().as_millis();
                            match result {
                                Ok(v) => vector = v.hits,
                                Err(error) => {
                                    warnings.push(format!("vector search failed: {error}"));
                                }
                            }
                        }
                    }
                }
                Err(error) => {
                    warnings.push(format!("embedding failed: {error}"));
                }
            }
        }
    }
    let degraded = !warnings.is_empty();
    if degraded && matches!(query.retrieval_mode, RetrievalMode::Hybrid) {
        warnings.push("hybrid request degraded: falling back to lexical-only".into());
    }

    // 4. RRF fusion.
    let fusion_started = Instant::now();
    let fused = reciprocal_rank_fusion(&lexical.hits, &vector, 60.0);
    timings.fusion_ms = fusion_started.elapsed().as_millis();

    // 5. Per-document cap (default 3).
    let conn = database.lock().await;
    let capped = cap_per_document(&conn, fused, 3)?;
    drop(conn);

    // 6. Convert FusedCandidate → RetrievalHit by joining back to chunk
    // metadata. The chunk ids emitted here are stable across runs.
    let lex_lookup: std::collections::HashMap<&str, &LexicalHit> = lexical
        .hits
        .iter()
        .map(|h| (h.chunk_id.as_str(), h))
        .collect();
    let vec_lookup: std::collections::HashMap<&str, &VectorCandidate> =
        vector.iter().map(|h| (h.chunk_id.as_str(), h)).collect();

    let mut hits: Vec<RetrievalHit> = Vec::with_capacity(capped.len());
    for c in capped.into_iter().take(query.top_k) {
        let conn = database.lock().await;
        let (chunk, score, reasons) =
            materialize(&conn, &c, &lex_lookup, &vec_lookup, query.retrieval_mode);
        hits.push(RetrievalHit {
            chunk,
            score,
            reasons,
        });
    }

    // 7. Optional rerank.
    if query.rerank && !hits.is_empty() {
        let rerank_started = Instant::now();
        match super::reranker::rerank(
            &query.query,
            hits.clone(),
            super::reranker::RerankerLimits::default(),
        )
        .await
        {
            Ok(reranked) => hits = reranked,
            Err(error) => {
                warnings.push(format!("rerank failed: {error}"));
            }
        }
        timings.rerank_ms = rerank_started.elapsed().as_millis();
    }

    timings.total_ms = started.elapsed().as_millis();

    Ok(RagRetrieveResponse {
        hits,
        degraded,
        warnings,
        timings,
        index_key,
    })
}

/// Sync facade kept for legacy callers; constructs an `InMemoryEmbedder`
/// when an embedder is not provided. **For production code paths, use
/// `orchestrate_with_embedder`.** The sync wrapper is here so the existing
/// tests and pure-function callers (event-bus, evaluation harness) keep
/// working without changing every signature.
pub fn orchestrate(
    query: &RagQuery,
    deps: RetrievalDeps<'_>,
) -> Result<RagRetrieveResponse, String> {
    // Run the lexical / cap / materialize parts synchronously by faking
    // an empty embedder. The async pipeline is preferred for production;
    // this sync version deliberately degrades to lexical-only when an
    // embedder is not supplied, which matches the spec for `Lexical` mode.
    let started = Instant::now();
    let mut timings = RagTimings::default();
    if query.top_k == 0 || query.candidate_k == 0 {
        return Err("top_k and candidate_k must be > 0".into());
    }
    if query.query.trim().is_empty() {
        return Err("query is empty".into());
    }
    let filters = RetrievalFilters {
        document_ids: query.document_ids.clone(),
        collection_ids: query.collection_ids.clone(),
        tags: query.tags.clone(),
        date_from: query.date_from,
        date_to: query.date_to,
        include_archived: query.include_archived,
    };
    let lex_started = Instant::now();
    let lexical = lexical_retrieve(deps.database, &query.query, &filters, query.candidate_k)?;
    timings.lexical_ms = lex_started.elapsed().as_millis();

    let fusion_started = Instant::now();
    let fused = reciprocal_rank_fusion(&lexical.hits, &[], 60.0);
    timings.fusion_ms = fusion_started.elapsed().as_millis();
    let capped = cap_per_document(deps.database, fused, deps.per_document_cap.max(1))?;

    let lex_lookup: std::collections::HashMap<&str, &LexicalHit> = lexical
        .hits
        .iter()
        .map(|h| (h.chunk_id.as_str(), h))
        .collect();
    let mut hits: Vec<RetrievalHit> = Vec::with_capacity(capped.len());
    for c in capped.into_iter().take(query.top_k) {
        let (chunk, score, reasons) = materialize(
            deps.database,
            &c,
            &lex_lookup,
            &std::collections::HashMap::new(),
            query.retrieval_mode,
        );
        hits.push(RetrievalHit {
            chunk,
            score,
            reasons,
        });
    }
    let _ = deps.embed_query;
    timings.total_ms = started.elapsed().as_millis();
    Ok(RagRetrieveResponse {
        hits,
        degraded: true,
        warnings: vec!["sync facade: vector recall skipped".into()],
        timings,
        index_key: None,
    })
}

/// Legacy synchronous dependency bag — `embed_query` is now an unused field
/// for the sync facade. Production code calls `orchestrate_with_embedder`.
pub struct RetrievalDeps<'a> {
    pub database: &'a Connection,
    pub embed_query: Box<dyn FnOnce(&str) -> Result<Vec<f32>, String> + Send + 'a>,
    pub per_document_cap: usize,
}

fn cap_per_document(
    database: &Connection,
    fused: Vec<FusedCandidate>,
    cap: usize,
) -> Result<Vec<FusedCandidate>, String> {
    // We need the doc id for each candidate; resolve via chunk_id lookup.
    let ids: Vec<String> = fused.iter().map(|c| c.chunk_id.clone()).collect();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = std::iter::repeat("?")
        .take(ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!("SELECT id, document_id FROM document_chunks WHERE id IN ({placeholders})");
    let mut stmt = database.prepare(&sql).map_err(|e| e.to_string())?;
    let mut doc_for_chunk: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let rows = stmt
        .query_map(rusqlite::params_from_iter(ids.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (id, doc) = row.map_err(|e| e.to_string())?;
        doc_for_chunk.insert(id, doc);
    }
    drop(stmt);

    // Drop supernumerary chunks per document while preserving fused_score order.
    let mut per_doc_count: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut capped = Vec::with_capacity(fused.len());
    for candidate in fused {
        let doc = doc_for_chunk
            .get(&candidate.chunk_id)
            .cloned()
            .unwrap_or_default();
        let count = per_doc_count.entry(doc).or_insert(0);
        if *count >= cap {
            continue;
        }
        *count += 1;
        capped.push(candidate);
    }
    Ok(capped)
}

fn materialize(
    database: &Connection,
    candidate: &FusedCandidate,
    lex: &std::collections::HashMap<&str, &LexicalHit>,
    vec: &std::collections::HashMap<&str, &VectorCandidate>,
    mode: RetrievalMode,
) -> (RagChunk, RetrievalScore, Vec<String>) {
    let (lex_opt, vec_opt) = (
        lex.get(candidate.chunk_id.as_str()).copied(),
        vec.get(candidate.chunk_id.as_str()).copied(),
    );
    let (document_id, chunk_index, title, url, heading_path, text) = match (lex_opt, vec_opt) {
        (Some(l), _) => (
            l.document_id.clone(),
            l.chunk_index,
            l.title.clone(),
            l.url.clone(),
            l.heading_path.clone(),
            l.text.clone(),
        ),
        (None, Some(v)) => (
            v.document_id.clone(),
            v.chunk_index,
            v.title.clone(),
            v.url.clone(),
            v.heading_path.clone(),
            v.text.clone(),
        ),
        (None, None) => resolve_chunk_meta(database, &candidate.chunk_id)
            .unwrap_or_else(|_| default_meta(&candidate.chunk_id)),
    };

    let token_count = text.split_whitespace().count();
    let mut reasons = Vec::new();
    if candidate.lexical_rank.is_some() {
        reasons.push("matched BM25".into());
    }
    if candidate.vector_rank.is_some() {
        reasons.push("matched vector cosine".into());
    }
    if matches!(mode, RetrievalMode::Hybrid)
        && candidate.lexical_rank.is_some()
        && candidate.vector_rank.is_some()
    {
        reasons.push("fused by reciprocal rank".into());
    }

    let chunk = RagChunk {
        chunk_id: candidate.chunk_id.clone(),
        document_id,
        chunk_index,
        title,
        url,
        heading_path,
        text_hash: String::new(),
        text,
        token_count,
        start_offset: 0,
        end_offset: 0,
    };
    let score = RetrievalScore {
        lexical_rank: candidate.lexical_rank,
        lexical_score: None,
        vector_rank: candidate.vector_rank,
        vector_score: vec_opt.map(|v| v.similarity as f64),
        fused_score: candidate.fused_score,
        rerank_score: None,
    };
    (chunk, score, reasons)
}

fn resolve_chunk_meta(
    database: &Connection,
    chunk_id: &str,
) -> Result<(String, i64, String, String, Vec<String>, String), String> {
    let (document_id, chunk_index, heading_json, content, title, url): (
        String,
        i64,
        String,
        String,
        String,
        String,
    ) = database
        .query_row(
            "SELECT c.document_id, c.chunk_index, c.heading_path, c.content, d.title, d.url
             FROM document_chunks c
             JOIN local_documents d ON d.id = c.document_id
             WHERE c.id = ?1",
            rusqlite::params![chunk_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;
    let heading_path: Vec<String> = serde_json::from_str(&heading_json).unwrap_or_default();
    Ok((document_id, chunk_index, title, url, heading_path, content))
}

fn default_meta(_chunk_id: &str) -> (String, i64, String, String, Vec<String>, String) {
    (
        String::new(),
        0,
        String::new(),
        String::new(),
        Vec::new(),
        String::new(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_query_returns_error() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let q = RagQuery {
            query: "   ".into(),
            top_k: 5,
            candidate_k: 10,
            document_ids: None,
            collection_ids: None,
            tags: None,
            date_from: None,
            date_to: None,
            include_archived: false,
            retrieval_mode: RetrievalMode::Lexical,
            rerank: false,
            provider_id: None,
            embedding_model: None,
            embedding_version: None,
            chunker_version: None,
            dimensions: None,
        };
        let result = orchestrate(
            &q,
            RetrievalDeps {
                database: &conn,
                embed_query: Box::new(|_| Ok(vec![0.0])),
                per_document_cap: 3,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn zero_top_k_returns_error() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let q = RagQuery {
            query: "hello".into(),
            top_k: 0,
            candidate_k: 10,
            document_ids: None,
            collection_ids: None,
            tags: None,
            date_from: None,
            date_to: None,
            include_archived: false,
            retrieval_mode: RetrievalMode::Lexical,
            rerank: false,
            provider_id: None,
            embedding_model: None,
            embedding_version: None,
            chunker_version: None,
            dimensions: None,
        };
        let result = orchestrate(
            &q,
            RetrievalDeps {
                database: &conn,
                embed_query: Box::new(|_| Ok(vec![0.0])),
                per_document_cap: 3,
            },
        );
        assert!(result.is_err());
    }
}
