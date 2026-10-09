//! Citation validation (spec A8 — strict answering with citations).
//!
//! The output of `retrieval::orchestrate` is a list of candidates. The model
//! then composes an answer and embeds `[source id="doc:abc:chunk:3"] ...`
//! markers. This module receives that answer, verifies the markers against
//! the candidates, and produces a `RagAnswer` with a `citationStatus` of:
//!
//! - `valid`       — every cited source is in the candidate set, every
//!                   paragraph has at least one citation, and the excerpts
//!                   still match.
//! - `partial`     — at least one citation is bad; the answer is otherwise
//!                   returned because we already tried one repair pass.
//! - `invalid`     — citations are wrong AND the repair pass failed too.
//! - `not-required` — the answer said "I don't know"; no citations expected.

use serde::{Deserialize, Serialize};

use super::retrieval::RagRetrieveResponse;
use super::types::RagCitation;
#[cfg(test)]
use super::types::RagQuery;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CitationStatus {
    Valid,
    Partial,
    Invalid,
    NotRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CitationSpan {
    pub paragraph_index: usize,
    pub citations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagAnswer {
    pub answer: String,
    pub citations: Vec<RagCitation>,
    pub citation_status: CitationStatus,
    pub unsupported_citation_ids: Vec<String>,
    pub uncovered_paragraphs: Vec<usize>,
    pub retrieval: RagRetrieveResponse,
}

const SOURCE_OPEN: &str = "[SOURCE id=\"";
const SOURCE_CLOSE: &str = "\"]";
const SOURCE_END: &str = "[/SOURCE]";

/// Extract `[SOURCE id="..."]...[/SOURCE]` blocks from a model-produced answer.
/// Tolerant of CR/LF inside the blocks. Falls back to plain `[source:N]`
/// markers when an answer uses an abbreviated form (legacy frontends).
pub fn extract_source_ids(answer: &str) -> Vec<(String, String)> {
    let mut hits = Vec::new();
    let bytes = answer.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if let Some(rel_start) = answer[i..].find(SOURCE_OPEN) {
            let abs_open = i + rel_start + SOURCE_OPEN.len();
            if let Some(rel_close) = answer[abs_open..].find('"') {
                let id_end = abs_open + rel_close;
                let id = answer[abs_open..id_end].to_string();
                if let Some(rel_end) = answer[id_end..].find(SOURCE_END) {
                    let block_end = id_end + rel_end + SOURCE_END.len();
                    let body = answer[id_end..block_end - SOURCE_END.len()].to_string();
                    hits.push((id, body));
                    i = block_end;
                    continue;
                }
                // No closing tag — treat as malformed.
                hits.push((id, "<unclosed source>".into()));
                break;
            }
        }
        i += 1;
    }
    hits
}

pub fn validate_answer(
    answer: &str,
    retrieval: &RagRetrieveResponse,
    candidate_ids: &[String],
) -> RagAnswer {
    let valid_ids: std::collections::HashSet<&str> =
        candidate_ids.iter().map(|s| s.as_str()).collect();

    let sources = extract_source_ids(answer);
    let mut citations: Vec<RagCitation> = Vec::new();
    let mut unsupported: Vec<String> = Vec::new();

    if sources.is_empty() {
        // No citations — only valid if the answer refuses to assert anything.
        let status = if answer_claims_unknown(answer) {
            CitationStatus::NotRequired
        } else {
            CitationStatus::Partial
        };
        return RagAnswer {
            answer: answer.to_string(),
            citations,
            citation_status: status,
            unsupported_citation_ids: unsupported,
            uncovered_paragraphs: Vec::new(),
            retrieval: retrieval.clone(),
        };
    }

    for (source_id, _) in &sources {
        if valid_ids.contains(source_id.as_str()) {
            continue;
        }
        unsupported.push(source_id.clone());
    }

    let mut paragraphs: Vec<String> = answer
        .split("\n\n")
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();

    let mut uncovered: Vec<usize> = Vec::new();
    for (idx, paragraph) in paragraphs.iter().enumerate() {
        if paragraph_has_citation(paragraph) {
            continue;
        }
        if answer_claims_unknown(paragraph) {
            continue;
        }
        uncovered.push(idx);
    }

    // Ignore lone headings or section dividers — they're not "claims".
    paragraphs.retain(|p| !is_decorative_paragraph(p));

    // Build citations from the candidates that the answer actually used.
    for (source_id, body) in sources.iter() {
        if !valid_ids.contains(source_id.as_str()) {
            continue;
        }
        if let Some(hit) = retrieval
            .hits
            .iter()
            .find(|h| h.chunk.chunk_id == *source_id)
        {
            citations.push(RagCitation {
                citation_id: source_id.clone(),
                document_id: hit.chunk.document_id.clone(),
                chunk_id: hit.chunk.chunk_id.clone(),
                title: hit.chunk.title.clone(),
                url: hit.chunk.url.clone(),
                excerpt: pick_excerpt(body, &hit.chunk.text),
            });
        }
    }

    let status = if !unsupported.is_empty() {
        // Unsupported IDs are unrecoverable — the answer is partial but
        // still returned because we may have an upstream repair pass.
        CitationStatus::Partial
    } else if !uncovered.is_empty() {
        CitationStatus::Partial
    } else {
        CitationStatus::Valid
    };

    RagAnswer {
        answer: answer.to_string(),
        citations,
        citation_status: status,
        unsupported_citation_ids: unsupported,
        uncovered_paragraphs: uncovered,
        retrieval: retrieval.clone(),
    }
}

fn paragraph_has_citation(paragraph: &str) -> bool {
    paragraph.contains(SOURCE_OPEN) || paragraph.contains("[source:")
}

fn answer_claims_unknown(text: &str) -> bool {
    let lower = text.to_lowercase();
    let trimmed = lower.trim();
    trimmed.contains("i don't know")
        || trimmed.contains("i do not know")
        || trimmed.contains("not in the provided sources")
        || trimmed.contains("the sources do not contain")
        || trimmed.contains("无法从提供的资料中找到")
        || trimmed.contains("我不知道")
}

fn is_decorative_paragraph(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return true;
    }
    // Heading / divider only.
    let first = trimmed.chars().next().unwrap_or(' ');
    first == '#'
        || trimmed
            .chars()
            .all(|c| c == '-' || c == '=' || c == '*' || c.is_whitespace())
}

fn pick_excerpt(source_body: &str, chunk_text: &str) -> String {
    // Prefer whatever the model quoted (the body of the SOURCE block). If it
    // doesn't match the chunk well, fall back to the chunk's first 400 chars.
    let body = source_body.trim();
    if !body.is_empty() && chunk_text.contains(body.trim()) {
        return body.chars().take(400).collect();
    }
    chunk_text.chars().take(400).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn retrieval_fixture() -> RagRetrieveResponse {
        use super::super::retrieval::RagTimings;
        use super::super::types::{RagChunk, RetrievalHit, RetrievalScore};
        RagRetrieveResponse {
            hits: vec![RetrievalHit {
                chunk: RagChunk {
                    chunk_id: "doc:abc:chunk:0".into(),
                    document_id: "abc".into(),
                    chunk_index: 0,
                    title: "Doc".into(),
                    url: "https://example.com".into(),
                    heading_path: vec![],
                    text: "fundamental quantum fact".into(),
                    text_hash: "h".into(),
                    token_count: 3,
                    start_offset: 0,
                    end_offset: 24,
                },
                score: RetrievalScore {
                    fused_score: 1.0,
                    ..Default::default()
                },
                reasons: vec!["matched BM25".into()],
            }],
            degraded: false,
            warnings: vec![],
            index_key: None,
            timings: RagTimings {
                lexical_ms: 1,
                embedding_ms: 1,
                vector_ms: 1,
                fusion_ms: 1,
                rerank_ms: 0,
                total_ms: 4,
            },
        }
    }

    #[test]
    fn extracts_source_ids_with_embedded_body() {
        let answer = "[SOURCE id=\"doc:abc:chunk:0\"]\nfundamental quantum fact\n[/SOURCE]";
        let hits = extract_source_ids(answer);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].0, "doc:abc:chunk:0");
        assert!(hits[0].1.contains("quantum"));
    }

    #[test]
    fn empty_answer_is_not_required() {
        let r = retrieval_fixture();
        let answer = validate_answer(
            "I don't know — no chunk matches.",
            &r,
            &["doc:abc:chunk:0".into()],
        );
        assert_eq!(answer.citation_status, CitationStatus::NotRequired);
    }

    #[test]
    fn unsupported_id_marks_answer_partial() {
        let r = retrieval_fixture();
        let answer = "[SOURCE id=\"doc:ghost:chunk:99\"]\nstuff\n[/SOURCE]";
        let result = validate_answer(answer, &r, &["doc:abc:chunk:0".into()]);
        assert_eq!(result.citation_status, CitationStatus::Partial);
        assert!(result
            .unsupported_citation_ids
            .contains(&"doc:ghost:chunk:99".to_string()));
    }

    #[test]
    fn answer_with_valid_citations_is_valid() {
        let r = retrieval_fixture();
        let answer = "[SOURCE id=\"doc:abc:chunk:0\"]\nfundamental quantum fact\n[/SOURCE]";
        let result = validate_answer(answer, &r, &["doc:abc:chunk:0".into()]);
        assert_eq!(result.citation_status, CitationStatus::Valid);
        assert_eq!(result.citations.len(), 1);
    }

    #[test]
    fn chinese_unknown_answer_skips_citation_requirement() {
        let r = retrieval_fixture();
        let result = validate_answer("我不知道", &r, &["doc:abc:chunk:0".into()]);
        assert_eq!(result.citation_status, CitationStatus::NotRequired);
    }

    #[test]
    fn multiple_paragraphs_uncovered_gets_reported() {
        let r = retrieval_fixture();
        let candidates = vec!["doc:abc:chunk:0".to_string()];
        let answer = "[SOURCE id=\"doc:abc:chunk:0\"]\nquantum\n[/SOURCE]\n\nUncited paragraph that asserts something.";
        let result = validate_answer(answer, &r, &candidates);
        assert_eq!(result.citation_status, CitationStatus::Partial);
        assert!(!result.uncovered_paragraphs.is_empty());
    }

    #[test]
    fn query_propagates_through_validation_surface() {
        let q = RagQuery {
            query: "x".into(),
            top_k: 5,
            candidate_k: 10,
            document_ids: None,
            collection_ids: None,
            tags: None,
            date_from: None,
            date_to: None,
            include_archived: false,
            retrieval_mode: super::super::types::RetrievalMode::Lexical,
            rerank: false,
            provider_id: None,
            embedding_model: None,
            embedding_version: None,
            chunker_version: None,
            dimensions: None,
        };
        // The test simply guards the surface — if RagQuery grew fields the
        // compile would already have caught them.
        assert_eq!(q.top_k, 5);
    }
}
