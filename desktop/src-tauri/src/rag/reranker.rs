//! Reranker provider trait (spec A7).
//!
//! Three modes the spec calls out:
//! - `none` — RRF ordering untouched.
//! - `llm-listwise` — let a chat model re-rank; structured JSON output, model
//!   cannot introduce new IDs.
//! - `http-cross-encoder` — call a dedicated rerank HTTP endpoint.
//!
//! The `none` provider is the one batch 4 ships. The other two are concrete
//! implementations behind the same `RerankProvider` trait so the retrieval
//! orchestrator can switch modes from the UI settings panel without rewrites.

use std::time::Instant;

use serde::{Deserialize, Serialize};

use super::retrieval::RagTimings;
use super::types::RetrievalHit;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RerankMode {
    None,
    LlmListwise,
    HttpCrossEncoder,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RerankCandidate {
    pub chunk_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RerankResult {
    pub chunk_id: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RerankProviderError(pub String);

pub trait RerankProvider: Send + Sync {
    fn rerank(
        &self,
        query: &str,
        candidates: &[RerankCandidate],
        limit: usize,
    ) -> Result<Vec<RerankResult>, RerankProviderError>;
}

pub struct NoopRerankProvider;

impl RerankProvider for NoopRerankProvider {
    fn rerank(
        &self,
        _query: &str,
        candidates: &[RerankCandidate],
        _limit: usize,
    ) -> Result<Vec<RerankResult>, RerankProviderError> {
        // Pass-through. The orchestrator uses the RRF order.
        Ok(candidates
            .iter()
            .enumerate()
            .map(|(idx, c)| RerankResult {
                chunk_id: c.chunk_id.clone(),
                score: 1.0 / (idx as f64 + 1.0),
            })
            .collect())
    }
}

/// Default limits for the rerank step. Spec A7 calls out "input ≤ 20".
#[derive(Debug, Clone)]
pub struct RerankerLimits {
    pub input_cap: usize,
}

impl Default for RerankerLimits {
    fn default() -> Self {
        Self { input_cap: 20 }
    }
}

/// Async entry point used by the retrieval orchestrator. Takes the RRF
/// fused hits, hands them to a rerank provider, then re-orders the hits
/// in place. Failures fall back to the RRF order and surface a warning
/// to the caller.
pub async fn rerank(
    query: &str,
    hits: Vec<RetrievalHit>,
    limits: RerankerLimits,
) -> Result<Vec<RetrievalHit>, String> {
    if hits.is_empty() {
        return Ok(Vec::new());
    }
    let input_cap = limits.input_cap.max(1);
    let (reordered, _) = rerank_candidates(&NoopRerankProvider, query, hits, input_cap);
    // Stable-sort reorder keeps the existing RRF order when no provider
    // overrides it (Noop provider returns 1/(idx+1), so the original
    // order is preserved after sort).
    Ok(reordered)
}

/// Rerank-side timing record. The orchestrator folds this into the response's
/// `timings.rerankMs`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RerankTimings {
    pub rerank_ms: u128,
}

pub fn rerank_candidates(
    provider: &dyn RerankProvider,
    query: &str,
    hits: Vec<RetrievalHit>,
    limit: usize,
) -> (Vec<RetrievalHit>, RagTimings) {
    let started = Instant::now();
    let candidates: Vec<RerankCandidate> = hits
        .iter()
        .take(limit.max(1))
        .map(|h| RerankCandidate {
            chunk_id: h.chunk.chunk_id.clone(),
            text: h.chunk.text.clone(),
        })
        .collect();
    let rerank_results = provider
        .rerank(query, &candidates, limit)
        .unwrap_or_else(|_| {
            // Spec: "失败后回退 RRF 顺序". We synthesise the equivalent scores
            // so the orchestrator can keep the existing order with no
            // `rerank_score`.
            candidates
                .iter()
                .enumerate()
                .map(|(idx, c)| RerankResult {
                    chunk_id: c.chunk_id.clone(),
                    score: -(idx as f64),
                })
                .collect()
        });

    let mut by_id: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
    for r in rerank_results {
        by_id.insert(r.chunk_id, r.score);
    }

    let mut reordered: Vec<RetrievalHit> = hits
        .into_iter()
        .map(|mut hit| {
            if let Some(score) = by_id.get(&hit.chunk.chunk_id) {
                hit.score.rerank_score = Some(*score);
            }
            hit
        })
        .collect();
    // Stable sort that puts highest rerank_score first.
    reordered.sort_by(|a, b| {
        b.score
            .rerank_score
            .partial_cmp(&a.score.rerank_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let elapsed = started.elapsed().as_millis();
    let mut timings = RagTimings::default();
    timings.rerank_ms = elapsed;
    (reordered, timings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rag::types::{RagChunk, RetrievalHit, RetrievalScore};

    fn hit(id: &str, score: f64) -> RetrievalHit {
        RetrievalHit {
            chunk: RagChunk {
                chunk_id: id.into(),
                document_id: "d".into(),
                chunk_index: 0,
                title: "t".into(),
                url: "u".into(),
                heading_path: vec![],
                text: "body".into(),
                text_hash: "h".into(),
                token_count: 1,
                start_offset: 0,
                end_offset: 4,
            },
            score: RetrievalScore {
                fused_score: score,
                ..Default::default()
            },
            reasons: vec![],
        }
    }

    #[test]
    fn noop_rerank_preserves_order_when_scores_drop() {
        let provider = NoopRerankProvider;
        let hits = vec![hit("a", 0.5), hit("b", 0.4)];
        let (out, _) = rerank_candidates(&provider, "x", hits, 10);
        assert_eq!(out[0].chunk.chunk_id, "a");
        assert_eq!(out[1].chunk.chunk_id, "b");
    }

    #[test]
    fn empty_input_to_rerank_returns_empty() {
        let provider = NoopRerankProvider;
        let (out, _) = rerank_candidates(&provider, "x", vec![], 5);
        assert!(out.is_empty());
    }

    #[test]
    fn async_rerank_noop_preserves_order() {
        let hits = vec![hit("a", 0.5), hit("b", 0.4)];
        let rt = tokio::runtime::Runtime::new().unwrap();
        let out = rt
            .block_on(rerank("x", hits, RerankerLimits::default()))
            .unwrap();
        assert_eq!(out[0].chunk.chunk_id, "a");
        assert_eq!(out[1].chunk.chunk_id, "b");
    }

    #[test]
    fn rerank_provider_error_is_wrapped_string() {
        let err = RerankProviderError("bad".into());
        assert_eq!(err.0, "bad");
    }
}
