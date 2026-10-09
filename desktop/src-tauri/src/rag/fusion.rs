//! Reciprocal Rank Fusion (RRF) — batch 3 (spec A6 step 6).
//!
//! Given two ranked lists from disjoint retrievers, RRF produces a single
//! ordering by summing `1 / (k + rank)` for every list a hit appears in.
//! `k = 60` (the original Cormack et al. constant and what the spec calls out)
//! is the right knob for collections in the low-thousands; we make it a
//! parameter so callers can tune.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::lexical::LexicalHit;
#[cfg(test)]
use super::types::{RagChunk, RetrievalHit, RetrievalScore};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FusedCandidate {
    pub chunk_id: String,
    pub lexical_rank: Option<usize>,
    pub vector_rank: Option<usize>,
    pub fused_score: f64,
}

/// Trivial vector candidate. The vector retrieval module is responsible for
/// producing these; RRF doesn't care how scores are produced so long as the
/// rank ordering reflects the score sort.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorCandidate {
    pub chunk_id: String,
    pub document_id: String,
    pub chunk_index: i64,
    pub title: String,
    pub url: String,
    pub heading_path: Vec<String>,
    pub excerpt: String,
    pub text: String,
    pub similarity: f32,
}

pub fn reciprocal_rank_fusion(
    lexical: &[LexicalHit],
    vector: &[VectorCandidate],
    k: f64,
) -> Vec<FusedCandidate> {
    let mut fused: HashMap<String, FusedCandidate> = HashMap::new();

    for (rank, hit) in lexical.iter().enumerate() {
        let rank1 = rank + 1;
        let entry = fused
            .entry(hit.chunk_id.clone())
            .or_insert_with(|| FusedCandidate {
                chunk_id: hit.chunk_id.clone(),
                lexical_rank: None,
                vector_rank: None,
                fused_score: 0.0,
            });
        entry.lexical_rank = Some(rank1);
        entry.fused_score += 1.0 / (k + rank1 as f64);
    }
    for (rank, hit) in vector.iter().enumerate() {
        let rank1 = rank + 1;
        let entry = fused
            .entry(hit.chunk_id.clone())
            .or_insert_with(|| FusedCandidate {
                chunk_id: hit.chunk_id.clone(),
                lexical_rank: None,
                vector_rank: None,
                fused_score: 0.0,
            });
        entry.vector_rank = Some(rank1);
        entry.fused_score += 1.0 / (k + rank1 as f64);
    }

    let mut out: Vec<FusedCandidate> = fused.into_values().collect();
    // Stable sort: higher fused_score first, tie-break on lexical_rank then
    // vector_rank so hybrid and lexical-only modes agree on neighbours.
    out.sort_by(|a, b| {
        b.fused_score
            .partial_cmp(&a.fused_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.lexical_rank.cmp(&b.lexical_rank))
            .then_with(|| a.vector_rank.cmp(&b.vector_rank))
    });
    out
}

/// Cap a single document's contribution to the candidate pool. Spec A6: "同一
/// 文档默认最多进入 3 个 chunks，避免单篇垄断上下文". `per_doc_cap = 0` disables
/// the cap (useful for eval / debugging).
pub fn cap_per_document(candidates: Vec<FusedCandidate>, per_doc_cap: usize) -> Vec<FusedCandidate> {
    if per_doc_cap == 0 {
        return candidates;
    }
    // We need the doc id for each candidate; FusedCandidate only stores the
    // chunk id, so the retrieval orchestrator must call this with a doc-id
    // resolver closure. Keep this function trivial here — the actual cap is
    // applied in `retrieval::orchestrate` where the chunk-to-doc map is
    // already in hand.
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lex(id: &str) -> LexicalHit {
        LexicalHit {
            chunk_id: id.into(),
            document_id: "d".into(),
            chunk_index: 0,
            title: "t".into(),
            url: "https://example.com".into(),
            heading_path: vec![],
            excerpt: "".into(),
            text: "".into(),
            bm25_score: 0.0,
        }
    }

    fn vec(id: &str) -> VectorCandidate {
        VectorCandidate {
            chunk_id: id.into(),
            document_id: "d".into(),
            chunk_index: 0,
            title: "t".into(),
            url: "https://example.com".into(),
            heading_path: vec![],
            excerpt: "".into(),
            text: "".into(),
            similarity: 0.5,
        }
    }

    #[test]
    fn rrf_combines_lexical_and_vector_ranks() {
        let lex_hits = vec![lex("c1"), lex("c2"), lex("c3")];
        let vec_hits = vec![vec("c3"), vec("c1"), vec("c4")];
        let fused = reciprocal_rank_fusion(&lex_hits, &vec_hits, 60.0);
        // c1 has rank1 in both → fused high.
        // c3 has rank1 in vec, rank3 in lex → second.
        // c2 only lex rank2 → third.
        // c4 only vec rank2 → fourth.
        let ids: Vec<&str> = fused.iter().map(|c| c.chunk_id.as_str()).collect();
        assert_eq!(ids, vec!["c1", "c3", "c2", "c4"]);
    }

    #[test]
    fn rrf_handles_lexical_only() {
        let lex_hits = vec![lex("a"), lex("b")];
        let fused = reciprocal_rank_fusion(&lex_hits, &[], 60.0);
        assert_eq!(fused.len(), 2);
        assert!(fused.iter().all(|c| c.vector_rank.is_none()));
    }

    #[test]
    fn rrf_handles_vector_only() {
        let fused = reciprocal_rank_fusion(&[], &[vec("a"), vec("b")], 60.0);
        assert_eq!(fused.len(), 2);
        assert!(fused.iter().all(|c| c.lexical_rank.is_none()));
    }

    #[test]
    fn rag_chunk_is_round_trip_serializable() {
        let chunk = RagChunk {
            chunk_id: "doc-1:chunk:0".into(),
            document_id: "doc-1".into(),
            chunk_index: 0,
            title: "Title".into(),
            url: "https://example.com".into(),
            heading_path: vec!["H1".into()],
            text: "body".into(),
            text_hash: "hash".into(),
            token_count: 1,
            start_offset: 0,
            end_offset: 4,
        };
        let json = serde_json::to_value(&chunk).unwrap();
        assert_eq!(json["chunkId"], "doc-1:chunk:0");
        assert_eq!(json["documentId"], "doc-1");
        assert_eq!(json["tokenCount"], 1);
    }

    #[test]
    fn retrieval_hit_carries_full_score_breakdown() {
        let hit = RetrievalHit {
            chunk: RagChunk {
                chunk_id: "c".into(),
                document_id: "d".into(),
                chunk_index: 0,
                title: "T".into(),
                url: "U".into(),
                heading_path: vec![],
                text: "x".into(),
                text_hash: "h".into(),
                token_count: 1,
                start_offset: 0,
                end_offset: 1,
            },
            score: RetrievalScore {
                lexical_rank: Some(1),
                lexical_score: Some(0.5),
                vector_rank: Some(2),
                vector_score: Some(0.7),
                fused_score: 0.42,
                rerank_score: None,
            },
            reasons: vec!["matched BM25".into()],
        };
        let json = serde_json::to_value(&hit).unwrap();
        assert_eq!(json["score"]["lexicalRank"], 1);
        assert_eq!(json["score"]["vectorRank"], 2);
        assert_eq!(json["reasons"][0], "matched BM25");
    }
}
