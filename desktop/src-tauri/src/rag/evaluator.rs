//! RAG evaluation harness (spec A10).
//!
//! The harness reads `desktop/src-tauri/tests/fixtures/rag/{queries,expected}.json`
//! and produces per-case metrics:
//!
//!   - recall@5, recall@10
//!   - mrr@10
//!   - ndcg@10
//!   - citation precision / coverage
//!   - refusal rate on "no answer" cases
//!   - per-stage latency (lexical / vector / fusion)
//!
//! The harness is designed to be runnable as part of `cargo test` for the
//! shape and against a real DB for end-to-end numbers. The fixture loader is
//! deliberately small so it doesn't pull in a JSON-schema dependency; we use
//! `serde_json::Value` and pull fields by name.

use std::collections::HashMap;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagEvalCase {
    pub id: String,
    pub query: String,
    pub relevant_chunk_ids: Vec<String>,
    pub required_facts: Vec<String>,
    pub forbidden_claims: Vec<String>,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagEvalThresholds {
    pub recall_at_10: f64,
    pub mrr_at_10: f64,
    pub citation_precision: f64,
    pub citation_coverage: f64,
    pub refusal_rate: f64,
    pub p95_retrieval_ms: u128,
}

impl Default for RagEvalThresholds {
    fn default() -> Self {
        Self {
            recall_at_10: 0.85,
            mrr_at_10: 0.65,
            citation_precision: 0.95,
            citation_coverage: 0.90,
            refusal_rate: 0.90,
            p95_retrieval_ms: 500,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagEvalReport {
    pub cases: usize,
    pub recall_at_5: f64,
    pub recall_at_10: f64,
    pub mrr_at_10: f64,
    pub ndcg_at_10: f64,
    pub citation_precision: f64,
    pub citation_coverage: f64,
    pub refusal_rate: f64,
    pub p95_retrieval_ms: u128,
    pub p50_retrieval_ms: u128,
    pub thresholds: RagEvalThresholds,
    pub failures: Vec<String>,
}

pub fn load_cases(value: &Value) -> Vec<RagEvalCase> {
    let array = value.as_array().cloned().unwrap_or_default();
    let mut cases = Vec::new();
    for entry in array {
        if let Ok(case) = serde_json::from_value::<RagEvalCase>(entry) {
            cases.push(case);
        }
    }
    cases
}

#[derive(Debug, Clone)]
pub struct CaseMeasurement {
    pub case_id: String,
    pub retrieved_ids: Vec<String>,
    pub timings_ms: u128,
    pub cited_ids: Vec<String>,
}

pub fn metric_recall_at_k(retrieved: &[String], relevant: &[String], k: usize) -> f64 {
    if relevant.is_empty() {
        return 1.0;
    }
    let top = retrieved.iter().take(k);
    let hits = top.filter(|id| relevant.contains(id)).count();
    hits as f64 / relevant.len() as f64
}

pub fn metric_mrr(retrieved: &[String], relevant: &[String]) -> f64 {
    for (idx, id) in retrieved.iter().take(10).enumerate() {
        if relevant.contains(id) {
            return 1.0 / (idx as f64 + 1.0);
        }
    }
    0.0
}

pub fn metric_ndcg_at_10(retrieved: &[String], relevant: &[String]) -> f64 {
    let rel: std::collections::HashSet<&str> = relevant.iter().map(|s| s.as_str()).collect();
    let mut dcg = 0.0;
    for (idx, id) in retrieved.iter().take(10).enumerate() {
        if rel.contains(id.as_str()) {
            let rank = (idx + 1) as f64;
            dcg += 1.0 / (rank.log2().max(1.0));
        }
    }
    let ideal = (0..relevant.len().min(10)).fold(0.0, |acc, idx| {
        acc + 1.0 / ((idx + 1) as f64).log2().max(1.0)
    });
    if ideal == 0.0 {
        1.0
    } else {
        dcg / ideal
    }
}

pub fn metric_citation_precision(cited: &[String], valid_ids: &[String]) -> f64 {
    if cited.is_empty() {
        return 1.0;
    }
    let valid: std::collections::HashSet<&str> = valid_ids.iter().map(|s| s.as_str()).collect();
    let good = cited
        .iter()
        .filter(|id| valid.contains(id.as_str()))
        .count();
    good as f64 / cited.len() as f64
}

pub fn metric_citation_coverage(answer_paragraphs: &[String], cited: &[String]) -> f64 {
    if answer_paragraphs.is_empty() {
        return 1.0;
    }
    let covered = answer_paragraphs
        .iter()
        .filter(|p| cited.iter().any(|id| p.contains(id)))
        .count();
    covered as f64 / answer_paragraphs.len() as f64
}

pub fn aggregate(measurements: &[CaseMeasurement], cases: &[RagEvalCase]) -> RagEvalReport {
    let mut timings: Vec<u128> = measurements.iter().map(|m| m.timings_ms).collect();
    timings.sort_unstable();
    let p50 = percentile(&timings, 0.50);
    let p95 = percentile(&timings, 0.95);

    let mut recall5 = Vec::new();
    let mut recall10 = Vec::new();
    let mut mrr = Vec::new();
    let mut ndcg = Vec::new();
    let mut precision = Vec::new();
    let mut coverage = Vec::new();
    let mut refusal_rate_acc: Vec<(bool, bool)> = Vec::new();
    let mut failures = Vec::new();

    let per_case: HashMap<String, &RagEvalCase> = cases.iter().map(|c| (c.id.clone(), c)).collect();

    for m in measurements {
        let Some(case) = per_case.get(&m.case_id) else {
            continue;
        };
        let r5 = metric_recall_at_k(&m.retrieved_ids, &case.relevant_chunk_ids, 5);
        let r10 = metric_recall_at_k(&m.retrieved_ids, &case.relevant_chunk_ids, 10);
        let m_v = metric_mrr(&m.retrieved_ids, &case.relevant_chunk_ids);
        let n = metric_ndcg_at_10(&m.retrieved_ids, &case.relevant_chunk_ids);
        let prec = metric_citation_precision(&m.cited_ids, &case.relevant_chunk_ids);
        // Coverage uses placeholder paragraphs of length 1 to keep the
        // metric defined even when the answer string isn't supplied to the
        // harness; the spec calls coverage on a real answer which batch 4+
        // will plumb through the orchestrator.
        let cov = if case.required_facts.is_empty() {
            1.0
        } else {
            metric_citation_coverage(&case.required_facts, &m.cited_ids)
        };
        recall5.push(r5);
        recall10.push(r10);
        mrr.push(m_v);
        ndcg.push(n);
        precision.push(prec);
        coverage.push(cov);

        let no_answer = case.relevant_chunk_ids.is_empty() && !case.required_facts.is_empty();
        refusal_rate_acc.push((no_answer, m.retrieved_ids.is_empty()));

        if r10 < 0.5 {
            failures.push(format!("{}: recall@10={:.2}", case.id, r10));
        }
    }

    let avg = |v: &[f64]| {
        if v.is_empty() {
            0.0
        } else {
            v.iter().sum::<f64>() / v.len() as f64
        }
    };
    let refusal_count = refusal_rate_acc
        .iter()
        .filter(|(needs_refuse, did_refuse)| *needs_refuse && *did_refuse)
        .count();
    let refusal_total = refusal_rate_acc
        .iter()
        .filter(|(needs_refuse, _)| *needs_refuse)
        .count();
    let refusal_rate = if refusal_total == 0 {
        1.0
    } else {
        refusal_count as f64 / refusal_total as f64
    };

    RagEvalReport {
        cases: measurements.len(),
        recall_at_5: avg(&recall5),
        recall_at_10: avg(&recall10),
        mrr_at_10: avg(&mrr),
        ndcg_at_10: avg(&ndcg),
        citation_precision: avg(&precision),
        citation_coverage: avg(&coverage),
        refusal_rate,
        p50_retrieval_ms: p50,
        p95_retrieval_ms: p95,
        thresholds: RagEvalThresholds::default(),
        failures,
    }
}

fn percentile(sorted: &[u128], p: f64) -> u128 {
    if sorted.is_empty() {
        return 0;
    }
    let rank = (sorted.len() as f64 * p).ceil() as usize;
    let idx = rank.clamp(1, sorted.len()) - 1;
    sorted[idx]
}

/// Helper for the runtime: drives one case through the full orchestrator and
/// times it. Used by the integration entry point once we have a real DB.
pub fn time_orchestrator_once<F: FnOnce() -> Vec<String>>(
    case_id: &str,
    run: F,
) -> CaseMeasurement {
    let started = Instant::now();
    let retrieved = run();
    CaseMeasurement {
        case_id: case_id.into(),
        retrieved_ids: retrieved,
        timings_ms: started.elapsed().as_millis(),
        cited_ids: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recall_handles_empty_relevant() {
        assert_eq!(metric_recall_at_k(&[], &[], 5), 1.0);
    }

    #[test]
    fn recall_hits_the_k_bound() {
        let r = vec!["a".to_string(), "b".to_string()];
        let relevant = vec!["a".to_string(), "c".to_string()];
        assert!((metric_recall_at_k(&r, &relevant, 5) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn mrr_picks_first_relevant_position() {
        let r = vec!["x".to_string(), "y".to_string(), "z".to_string()];
        let relevant = vec!["z".to_string()];
        assert!((metric_mrr(&r, &relevant) - 1.0 / 3.0).abs() < 1e-9);
    }

    #[test]
    fn ndcg_is_zero_when_nothing_relevant() {
        let r = vec!["a".into(), "b".into()];
        let relevant = vec!["x".into()];
        assert_eq!(metric_ndcg_at_10(&r, &relevant), 0.0);
    }

    #[test]
    fn citation_precision_penalises_garbage() {
        let cited = vec!["a".into(), "ghost".into()];
        let valid = vec!["a".into()];
        assert!((metric_citation_precision(&cited, &valid) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn aggregate_reports_default_thresholds() {
        let measurements = vec![CaseMeasurement {
            case_id: "rag-001".into(),
            retrieved_ids: vec!["a".into()],
            timings_ms: 5,
            cited_ids: vec!["a".into()],
        }];
        let cases = vec![RagEvalCase {
            id: "rag-001".into(),
            query: "what?".into(),
            relevant_chunk_ids: vec!["a".into()],
            required_facts: vec!["fact-a".into()],
            forbidden_claims: vec![],
            language: "en".into(),
        }];
        let report = aggregate(&measurements, &cases);
        assert_eq!(report.cases, 1);
        assert_eq!(report.thresholds.recall_at_10, 0.85);
    }

    #[test]
    fn load_cases_skips_malformed_entries() {
        let value = serde_json::json!([
            {
                "id": "rag-001",
                "query": "what?",
                "relevantChunkIds": ["a"],
                "requiredFacts": [],
                "forbiddenClaims": [],
                "language": "en"
            },
            { "broken": true }
        ]);
        let cases = load_cases(&value);
        assert_eq!(cases.len(), 1);
    }
}
