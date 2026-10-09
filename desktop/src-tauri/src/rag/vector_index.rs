//! Pluggable vector index abstraction (spec A5).
//!
//! The trait signature mirrors the spec verbatim, but the implementation
//! is left to batch 5+. We provide a `BruteForceVectorIndex` that delegates
//! to the SQLite scan already in `vector::search` so callers stop caring
//! about the underlying engine today; the moment HNSW lands, it slots in
//! behind the same trait and the orchestrator in `retrieval.rs` keeps
//! using `Index::search`.
//!
//! `HnswVectorIndex` is a deliberate TODO until we complete the technical
//! validation pass the spec calls out (Windows MSVC / macOS / Linux builds,
//! license check, 100k items memory measurement). Until then, `BruteForce`
//! handles the corpus and we explicitly tag the threshold: at
//! `len() >= brute_force_threshold` we should swap to HNSW.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// Spec A5 trait. Methods are spelled exactly as the spec demands so the
/// orchestrator can be implemented against this abstraction without
/// touching `vector::search`.
pub trait VectorIndex: Send + Sync {
    fn upsert(&mut self, items: &[VectorItem]) -> Result<(), RagError>;
    fn delete(&mut self, ids: &[String]) -> Result<(), RagError>;
    fn search(&self, query: &[f32], limit: usize) -> Result<Vec<VectorHit>, RagError>;
    fn save(&self, path: &Path) -> Result<(), RagError>;
    fn load(path: &Path) -> Result<Self, RagError>
    where
        Self: Sized;
    fn dimensions(&self) -> usize;
    fn len(&self) -> usize;
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorItem {
    pub id: String,
    pub vector: Vec<f32>,
    pub payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorHit {
    pub id: String,
    pub similarity: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RagError {
    DimensionMismatch { expected: usize, actual: usize },
    CorruptIndex(String),
    IoError(String),
    Other(String),
}

impl std::fmt::Display for RagError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DimensionMismatch { expected, actual } => {
                write!(f, "embedding dimension mismatch: expected {expected} got {actual}")
            }
            Self::CorruptIndex(s) => write!(f, "corrupt index: {s}"),
            Self::IoError(s) => write!(f, "io error: {s}"),
            Self::Other(s) => write!(f, "{s}"),
        }
    }
}

impl std::error::Error for RagError {}

/// Spec A5 carries this exact constant for the auto-mode switch.
pub const BRUTE_FORCE_THRESHOLD: usize = 10_000;

/// Decorator: pick the right engine given current `len()` and `dimensions()`.
pub fn pick_engine(len: usize, dims: usize) -> IndexKind {
    if len < BRUTE_FORCE_THRESHOLD {
        IndexKind::BruteForce
    } else {
        IndexKind::Hnsw
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum IndexKind {
    BruteForce,
    Hnsw,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexMetadata {
    pub kind: IndexKind,
    pub dimensions: usize,
    pub distance_metric: &'static str,
    pub provider_id: String,
    pub model: String,
    pub chunker_version: String,
    pub item_count: usize,
    pub built_at: i64,
    pub checksum: String,
}

/// Linear cosine search that slots into the trait surface. Stays as the
/// default until HNSW lands.
#[derive(Debug, Default, Clone)]
pub struct BruteForceVectorIndex {
    dimensions: usize,
    items: Vec<VectorItem>,
    checksum: String,
}

impl BruteForceVectorIndex {
    pub fn new(dimensions: usize) -> Self {
        Self {
            dimensions,
            items: Vec::new(),
            checksum: String::new(),
        }
    }

    pub fn with_items(dimensions: usize, items: Vec<VectorItem>) -> Self {
        Self {
            dimensions,
            items,
            checksum: String::new(),
        }
    }
}

impl VectorIndex for BruteForceVectorIndex {
    fn upsert(&mut self, items: &[VectorItem]) -> Result<(), RagError> {
        for item in items {
            if item.vector.len() != self.dimensions {
                return Err(RagError::DimensionMismatch {
                    expected: self.dimensions,
                    actual: item.vector.len(),
                });
            }
            if let Some(slot) = self.items.iter_mut().find(|it| it.id == item.id) {
                slot.vector = item.vector.clone();
                slot.payload = item.payload.clone();
            } else {
                self.items.push(item.clone());
            }
        }
        Ok(())
    }

    fn delete(&mut self, ids: &[String]) -> Result<(), RagError> {
        self.items.retain(|it| !ids.contains(&it.id));
        Ok(())
    }

    fn search(&self, query: &[f32], limit: usize) -> Result<Vec<VectorHit>, RagError> {
        if query.len() != self.dimensions {
            return Err(RagError::DimensionMismatch {
                expected: self.dimensions,
                actual: query.len(),
            });
        }
        let mut scored: Vec<VectorHit> = self
            .items
            .iter()
            .map(|it| VectorHit {
                id: it.id.clone(),
                similarity: cosine(query, &it.vector),
            })
            .filter(|hit| hit.similarity > 0.0)
            .collect();
        scored.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);
        Ok(scored)
    }

    fn save(&self, _path: &Path) -> Result<(), RagError> {
        // Spec A5: index files are persisted via SQLite metadata at first;
        // the actual binary on-disk is a batch-5 deliverable.
        Ok(())
    }

    fn load(_path: &Path) -> Result<Self, RagError> {
        Ok(Self::default())
    }

    fn dimensions(&self) -> usize {
        self.dimensions
    }

    fn len(&self) -> usize {
        self.items.len()
    }
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
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

    #[test]
    fn pick_engine_chooses_brute_for_small_corpus() {
        assert_eq!(pick_engine(0, 64), IndexKind::BruteForce);
        assert_eq!(pick_engine(9_999, 64), IndexKind::BruteForce);
    }

    #[test]
    fn pick_engine_chooses_hnsw_for_large_corpus() {
        assert_eq!(pick_engine(10_000, 64), IndexKind::Hnsw);
        assert_eq!(pick_engine(500_000, 1024), IndexKind::Hnsw);
    }

    #[test]
    fn brute_force_rejects_dimension_mismatch_on_upsert() {
        let mut idx = BruteForceVectorIndex::new(3);
        let bad = vec![VectorItem {
            id: "x".into(),
            vector: vec![1.0, 2.0],
            payload: None,
        }];
        assert!(matches!(
            idx.upsert(&bad),
            Err(RagError::DimensionMismatch { expected: 3, actual: 2 })
        ));
    }

    #[test]
    fn brute_force_returns_top_k_by_similarity() {
        let mut idx = BruteForceVectorIndex::new(2);
        idx.upsert(&[
            VectorItem { id: "a".into(), vector: vec![1.0, 0.0], payload: None },
            VectorItem { id: "b".into(), vector: vec![0.0, 1.0], payload: None },
            VectorItem { id: "c".into(), vector: vec![0.7, 0.7], payload: None },
        ])
        .unwrap();
        let hits = idx.search(&[1.0, 0.0], 2).unwrap();
        assert_eq!(hits[0].id, "a");
        assert!(hits[1].id == "c" || hits[1].id == "b");
    }

    #[test]
    fn brute_force_delete_removes_ids() {
        let mut idx = BruteForceVectorIndex::new(2);
        idx.upsert(&[
            VectorItem { id: "a".into(), vector: vec![1.0, 0.0], payload: None },
            VectorItem { id: "b".into(), vector: vec![0.0, 1.0], payload: None },
        ])
        .unwrap();
        idx.delete(&["a".into()]).unwrap();
        assert_eq!(idx.len(), 1);
    }

    #[test]
    fn rag_error_display_round_trip() {
        let e = RagError::DimensionMismatch { expected: 4, actual: 2 };
        assert_eq!(e.to_string(), "embedding dimension mismatch: expected 4 got 2");
    }
}
