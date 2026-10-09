//! Stable data contract between the frontend and the Rust retrieval layer.
//!
//! These are the public-facing types from section A1 of the RAG epic. They are
//! serialised with `serde(rename_all = "camelCase")` so the existing TypeScript
//! surface lines up field-by-field; every derived value must keep the original
//! raw score alongside the fused score so the UI can explain *why* a hit was
//! returned.
//!
//! `citation_id` is intentionally a stable string of the form
//! `doc:{document_id}:chunk:{chunk_index}` so that downstream code can
//! reference a chunk by name across renders — never use the array index as a
//! permanent identifier.

use serde::{Deserialize, Serialize};

/// Retrieval-mode selection for a `RagQuery`. Hybrid is the recommended default
/// and degrades gracefully to lexical-only when the embedding provider is
/// unavailable.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalMode {
    Lexical,
    Vector,
    Hybrid,
}

/// Caller-supplied retrieval parameters. Sent by the frontend; the Rust side
/// owns the defaults (candidate_k / top_k) so the UI can't accidentally
/// request an unbounded scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagQuery {
    pub query: String,
    pub top_k: usize,
    pub candidate_k: usize,
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
    pub retrieval_mode: RetrievalMode,
    #[serde(default)]
    pub rerank: bool,
    /// Embedding provider id used to embed the query string and the index
    /// against which vector recall happens. The Rust side validates that the
    /// provider matches the indexed configuration.
    #[serde(default)]
    pub provider_id: Option<String>,
    /// Embedding model name. The Rust side refuses to vector-search when
    /// the active index was produced under a different model.
    #[serde(default)]
    pub embedding_model: Option<String>,
    /// Embedding version stamp (e.g. "markdown-structure-v1").
    #[serde(default)]
    pub embedding_version: Option<String>,
    /// Chunker version used at index time. Used to compute chunk IDs that
    /// line up with what the vector path will hit.
    #[serde(default)]
    pub chunker_version: Option<String>,
    /// Override embedding dimensions for vector search. `None` means "trust
    /// the query vector's length and look for matching `dims` rows".
    #[serde(default)]
    pub dimensions: Option<usize>,
}

/// Stable key identifying which `(provider_id, model, dimensions,
/// embedding_version, chunker_version)` tuple an index was built under.
/// Used by retrieval to validate that a query can be served by the active
/// index.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingIndexKey {
    pub provider_id: String,
    pub model: String,
    pub dimensions: usize,
    pub embedding_version: String,
    pub chunker_version: String,
}

/// A single chunk as returned by retrieval. The `chunk_id` and `text_hash`
/// fields are stable across runs of the same chunker version.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagChunk {
    pub chunk_id: String,
    pub document_id: String,
    pub chunk_index: i64,
    pub title: String,
    pub url: String,
    pub heading_path: Vec<String>,
    pub text: String,
    pub text_hash: String,
    pub token_count: usize,
    pub start_offset: usize,
    pub end_offset: usize,
}

/// Per-channel score breakdown. Missing channels are explicitly `None` rather
/// than zero so the UI can render "vector-only" / "lexical-only" honestly.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalScore {
    pub lexical_rank: Option<usize>,
    pub lexical_score: Option<f64>,
    pub vector_rank: Option<usize>,
    pub vector_score: Option<f64>,
    pub fused_score: f64,
    pub rerank_score: Option<f64>,
}

/// A retrieval candidate together with its score breakdown and the human
/// readable reasons it was returned (e.g. "matched BM25", "vector cosine").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalHit {
    pub chunk: RagChunk,
    pub score: RetrievalScore,
    pub reasons: Vec<String>,
}

/// Citation returned to the frontend as part of a `RagAnswer`. The
/// `citation_id` is stable across renders so callers can act on it without
/// needing to re-parse the answer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagCitation {
    pub citation_id: String,
    pub document_id: String,
    pub chunk_id: String,
    pub title: String,
    pub url: String,
    pub excerpt: String,
}

impl RagCitation {
    /// Build the canonical `citation_id` for a `(document_id, chunk_index)`
    /// pair. Centralised here so any consumer (chunk FTS hits, citations,
    /// evaluation harness) produces the same string.
    pub fn make_id(document_id: &str, chunk_index: i64) -> String {
        format!("doc:{document_id}:chunk:{chunk_index}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn citation_id_is_stable_and_prefixed() {
        let id = RagCitation::make_id("doc-abc", 7);
        assert_eq!(id, "doc:doc-abc:chunk:7");
    }

    #[test]
    fn retrieval_hit_serialises_in_camel_case() {
        let hit = RetrievalHit {
            chunk: RagChunk {
                chunk_id: "c1".into(),
                document_id: "d1".into(),
                chunk_index: 0,
                title: "T".into(),
                url: "https://example.com".into(),
                heading_path: vec!["h1".into()],
                text: "body".into(),
                text_hash: "h".into(),
                token_count: 1,
                start_offset: 0,
                end_offset: 4,
            },
            score: RetrievalScore {
                fused_score: 0.5,
                ..Default::default()
            },
            reasons: vec!["vector cosine".into()],
        };
        let json = serde_json::to_value(&hit).expect("serialise");
        assert_eq!(json["chunk"]["documentId"], "d1");
        assert_eq!(json["chunk"]["chunkIndex"], 0);
        assert_eq!(json["score"]["fusedScore"], 0.5);
        assert_eq!(json["reasons"][0], "vector cosine");
    }

    #[test]
    fn retrieval_mode_round_trips_for_all_variants() {
        for mode in [
            RetrievalMode::Lexical,
            RetrievalMode::Vector,
            RetrievalMode::Hybrid,
        ] {
            let raw = serde_json::to_string(&mode).unwrap();
            let back: RetrievalMode = serde_json::from_str(&raw).unwrap();
            assert_eq!(back, mode);
        }
    }
}
