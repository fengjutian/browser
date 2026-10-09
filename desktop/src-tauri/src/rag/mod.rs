//! Production RAG layer.
//!
//! Batch 1 of the RAG epic ships only the data contract: the cross-process
//! types we want frontend and backend to agree on before any retrieval
//! orchestration lands. Retrieval/indexer/reranker/citation implementations
//! will be added in later batches and live in sibling modules of this
//! directory.

pub mod chunker;
pub mod citation;
pub mod commands;
pub mod evaluator;
pub mod fusion;
pub mod indexer;
pub mod lexical;
pub mod reranker;
pub mod retrieval;
pub mod types;
pub mod vector;
pub mod vector_index;

pub use chunker::{plan_chunks, Chunk, ChunkPlan, CHUNKER_VERSION};
pub use indexer::{JobRow, IndexOutcome};
pub use types::{
    RagChunk, RagCitation, RagQuery, RetrievalHit, RetrievalMode, RetrievalScore,
};
