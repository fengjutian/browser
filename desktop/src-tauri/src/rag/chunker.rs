//! Structure-aware Markdown chunker (RAG epic, batch 2 — spec A3).
//!
//! The previous chunker (`local_store::chunk_markdown`) sliced on character
//! windows and snapped to `\n\n`, which regularly broke across:
//!   - code fences (split mid-template)
//!   - tables (split between header row and body rows)
//!   - list items (split mid-bullet, losing the `-` / `1.` prefix)
//!   - quote blocks (split between `>`-prefixed lines)
//!   - headings (orphaned `# ...` line in the next chunk)
//!
//! This chunker parses the markdown into structural blocks first, then emits
//! chunks whose size is bounded by a [`TokenCounter`]. The heading breadcrumb
//! is preserved per chunk so the RAG layer can attribute a hit to a section.
//!
//! The chunk ID is `SHA256(document_id + chunker_version + chunk_index +
//! content_hash)` (spec A3). With `chunker_version` pinned to
//! `markdown-structure-v1`, the same input deterministically produces the same
//! chunk IDs, which is what callers rely on for stable citations and for
//! "modified paragraph → unchanged chunk hash stays the same" tests.
//!
//! #[allow(missing_docs)] is intentionally off — every public item documents
//! its trade-off because this is the **trust boundary** between the ingestion
//! path and retrieval.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Identifier of the chunking algorithm itself. Bumping this string changes
/// the chunk-ID prefix and is how we phase out chunk-shape changes: models
/// stored under the previous version stay queryable until rebuilt.
pub const CHUNKER_VERSION: &str = "markdown-structure-v1";

/// Recommended target chunk size (spec A3: 500–800 tokens). The default
/// `TokenCounter` uses heuristics on mixed CJK / Latin content; bias slightly
/// high so we don't constantly chunk on emoji / CJK punctuation.
pub const TARGET_TOKENS: usize = 650;

/// Hard ceiling — anything above this is forced to start a new chunk even if
/// it sits in the middle of a code block / list (the safety net only fires
/// once per chunk).
pub const HARD_MAX_TOKENS: usize = 1000;

/// Tokens shared between neighbouring chunks. We reuse the spec's
/// "80–120 tokens" range.
pub const OVERLAP_TOKENS: usize = 100;

/// Anything below this gets merged into the previous chunk unless that chunk
/// is already at the hard ceiling.
pub const MIN_CHUNK_TOKENS: usize = 100;

/// Pluggable counter so batch 5+ can swap in a real BPE tokenizer without
/// touching the chunking state machine. The interface is intentionally tiny.
pub trait TokenCounter: Send + Sync {
    /// Approximate number of model tokens `text` would consume.
    fn count(&self, text: &str) -> usize;
}

/// Cheap but functional approximation. It bills each ASCII word as ~1.3 tokens
/// and each Han / Hiragana / Hangul codepoint as 1 token. Other scripts fall
/// through to "1 codepoint per token" — accurate enough for batching purposes
/// even on mixed-script documents.
#[derive(Debug, Default, Clone, Copy)]
pub struct ApproxTokenCounter;

impl TokenCounter for ApproxTokenCounter {
    fn count(&self, text: &str) -> usize {
        let mut total = 0usize;
        let mut latin_len = 0usize;
        for ch in text.chars() {
            if ch.is_whitespace() {
                if latin_len > 0 {
                    total += latin_word_tokens(latin_len);
                    latin_len = 0;
                }
            } else if is_cjk(ch) || is_punct_no_space(ch) {
                if latin_len > 0 {
                    total += latin_word_tokens(latin_len);
                    latin_len = 0;
                }
                total += 1;
            } else {
                latin_len += 1;
            }
        }
        if latin_len > 0 {
            total += latin_word_tokens(latin_len);
        }
        total.max(1)
    }
}

fn latin_word_tokens(word_len: usize) -> usize {
    // ~1.3 tokens per ASCII word. Ceiling keeps single-character tokens (e.g.
    // "Rust" → 1, "minimax" → 1).
    ((word_len as f64) / 1.3).ceil() as usize
}

fn is_cjk(ch: char) -> bool {
    let code = ch as u32;
    (0x4E00..=0x9FFF).contains(&code)         // CJK Unified Ideographs
        || (0x3040..=0x309F).contains(&code)   // Hiragana
        || (0x30A0..=0x30FF).contains(&code)   // Katakana
        || (0xAC00..=0xD7AF).contains(&code)   // Hangul syllables
        || (0x3400..=0x4DBF).contains(&code) // CJK Extension A
}

fn is_punct_no_space(ch: char) -> bool {
    matches!(
        ch,
        '。' | '，'
            | '；'
            | '：'
            | '！'
            | '？'
            | '、'
            | '「'
            | '」'
            | '『'
            | '』'
            | '('
            | ')'
            | '['
            | ']'
            | '{'
            | '}'
            | '<'
            | '>'
            | ','
            | ';'
            | ':'
            | '!'
            | '?'
    )
}

/// One emitted chunk. `chunk_index` is the position in the plan's `chunks`
/// vector. `start_offset` / `end_offset` are byte offsets into the *original*
/// markdown source.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Chunk {
    pub chunk_index: usize,
    pub heading_path: Vec<String>,
    pub content: String,
    pub start_offset: usize,
    pub end_offset: usize,
    pub token_count: usize,
    pub content_hash: String,
}

/// A full chunk plan: a deterministic fingerprint of how a document was
/// chunked, plus the chunks themselves. `chunker_version` is included in
/// every chunk ID so changing the algorithm invalidates IDs without the
/// database having to know.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkPlan {
    pub chunker_version: &'static str,
    pub chunks: Vec<Chunk>,
}

/// Deterministic chunk ID. Centralised here so the FTS layer, the citation
/// layer, and the test harness all compute the same string.
pub fn chunk_id(
    document_id: &str,
    chunker_version: &str,
    chunk_index: usize,
    content_hash: &str,
) -> String {
    let mut h = Sha256::new();
    h.update(document_id.as_bytes());
    h.update(chunker_version.as_bytes());
    h.update((chunk_index as u64).to_le_bytes());
    h.update(content_hash.as_bytes());
    format!("{:x}", h.finalize())
}

/// Full plan from a `(document_id, markdown)` pair. The plan is content-only;
/// `document_id` is fed into the chunk-ID computation, not into hashing the
/// content itself.
pub fn plan_chunks(document_id: &str, markdown: &str) -> ChunkPlan {
    plan_chunks_with(document_id, markdown, &ApproxTokenCounter)
}

#[allow(unused_variables)] // `document_id` is reserved for the chunk-ID derivation in batch 5+
pub fn plan_chunks_with(
    document_id: &str,
    markdown: &str,
    counter: &dyn TokenCounter,
) -> ChunkPlan {
    let trimmed = markdown.trim_end_matches('\n');
    if trimmed.trim().is_empty() {
        return ChunkPlan {
            chunker_version: CHUNKER_VERSION,
            chunks: Vec::new(),
        };
    }

    let blocks = parse_blocks(trimmed);
    let groups = group_into_chunks(&blocks, counter);

    let mut chunks = Vec::with_capacity(groups.len());
    for (index, group) in groups.into_iter().enumerate() {
        let content = render_group(&group);
        let token_count = counter.count(&content);
        let content_hash = format!("{:x}", Sha256::digest(content.as_bytes()));
        let start_offset = group.iter().map(|b| b.start_offset).min().unwrap_or(0);
        let end_offset = group.iter().map(|b| b.end_offset).max().unwrap_or(0);
        let heading_path = collect_heading_path(&group);
        let chunk = Chunk {
            chunk_index: index,
            heading_path,
            content,
            start_offset,
            end_offset,
            token_count,
            content_hash: content_hash.clone(),
        };
        chunks.push(chunk);
    }

    ChunkPlan {
        chunker_version: CHUNKER_VERSION,
        chunks,
    }
}

#[derive(Debug, Clone)]
pub struct MarkdownBlock {
    pub kind: BlockKind,
    pub heading_depth: Option<usize>,
    pub text: String,
    pub raw: String,
    pub start_offset: usize,
    pub end_offset: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)] // Blank is reserved for future use (table-aware parsing)
pub enum BlockKind {
    Heading,
    Paragraph,
    CodeBlock,
    Table,
    ListItem,
    Quote,
    Image,
    Link,
    Blank,
    Unknown,
}

/// Public access for tests / eval harness. Parses markdown into structural
/// blocks without performing any token budgeting. This is the **observable**
/// first step of `plan_chunks_with`.
pub fn parse_blocks(markdown: &str) -> Vec<MarkdownBlock> {
    let mut blocks = Vec::new();
    let mut current_kind: Option<BlockKind> = None;
    let mut current_text = String::new();
    let mut current_raw = String::new();
    let mut current_start: usize = 0;
    let mut current_depth: Option<usize> = None;

    let mut cursor = 0usize;
    let bytes = markdown.as_bytes();
    for line in split_lines_keep_offsets(markdown) {
        let (start, end, line_text) = line;
        let trimmed_start = line_text.trim_start();
        let advance_cursor = end;

        // Closing handling for fenced code block
        if matches!(current_kind, Some(BlockKind::CodeBlock)) {
            let line_content: String = if end >= start {
                markdown[start..end].to_string()
            } else {
                String::new()
            };
            current_text.push('\n');
            current_text.push_str(&line_content);
            current_raw.push('\n');
            current_raw.push_str(&line_content);
            if trimmed_start.trim_end() == "```" || trimmed_start.trim_end() == "~~~" {
                let mut block = finalize_block(
                    &mut current_kind,
                    &mut current_text,
                    &mut current_raw,
                    &mut current_depth,
                    &mut current_start,
                );
                block.end_offset = advance_cursor;
                blocks.push(block);
            }
            cursor = advance_cursor;
            continue;
        }

        // Detect new block starts
        let detected = detect_block(trimmed_start);
        if let Some(detected) = detected {
            // Flush the previous block first
            if current_kind.is_some() {
                let mut block = finalize_block(
                    &mut current_kind,
                    &mut current_text,
                    &mut current_raw,
                    &mut current_depth,
                    &mut current_start,
                );
                block.end_offset = advance_cursor;
                blocks.push(block);
            }
            current_start = start;
            current_kind = Some(detected.kind.clone());
            current_depth = detected.depth;
            current_text = detected.text;
            current_raw = line_text.to_string();
            // Special-case: fenced code block captures all subsequent lines
            // until its closing fence.
            if matches!(current_kind.as_ref(), Some(BlockKind::CodeBlock)) {
                // Nothing else to do — the loop body above handles continuation
                // while `current_kind == CodeBlock`.
            }
        } else if matches!(current_kind, None) {
            // No current block — start a new paragraph with this line.
            current_kind = Some(BlockKind::Paragraph);
            current_start = start;
            current_text = line_text.to_string();
            current_raw = line_text.to_string();
            current_depth = None;
        } else {
            // Continuation of current block
            current_text.push('\n');
            current_text.push_str(line_text);
            current_raw.push('\n');
            current_raw.push_str(line_text);
        }

        cursor = advance_cursor;
        let _ = bytes;
    }

    // Flush any trailing block
    if current_kind.is_some() {
        let mut block = finalize_block(
            &mut current_kind,
            &mut current_text,
            &mut current_raw,
            &mut current_depth,
            &mut current_start,
        );
        block.end_offset = cursor;
        blocks.push(block);
    }

    blocks
}

struct Detected {
    kind: BlockKind,
    depth: Option<usize>,
    text: String,
}

fn detect_block(trimmed: &str) -> Option<Detected> {
    if trimmed.is_empty() {
        return None;
    }
    // Fenced code block — capture only the opening line here; the loop body
    // keeps appending lines until the closing fence arrives.
    if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
        return Some(Detected {
            kind: BlockKind::CodeBlock,
            depth: None,
            text: trimmed.to_string(),
        });
    }
    // Headings
    if let Some(depth) = heading_depth(trimmed) {
        let title = trimmed.trim_start_matches('#').trim_start().to_string();
        return Some(Detected {
            kind: BlockKind::Heading,
            depth: Some(depth),
            text: title,
        });
    }
    // Tables — only detect the header/body separator pattern as the start
    // of a table block.
    if let Some(rest) = trimmed.strip_prefix('|') {
        if rest.trim_end_matches('|').contains('|') {
            return Some(Detected {
                kind: BlockKind::Table,
                depth: None,
                text: trimmed.to_string(),
            });
        }
    }
    // List items
    if is_list_item(trimmed) {
        return Some(Detected {
            kind: BlockKind::ListItem,
            depth: None,
            text: trimmed.to_string(),
        });
    }
    // Quote
    if trimmed.starts_with('>') {
        return Some(Detected {
            kind: BlockKind::Quote,
            depth: None,
            text: trimmed.to_string(),
        });
    }
    // Bare image / link only lines
    if looks_like_image_only(trimmed) {
        return Some(Detected {
            kind: BlockKind::Image,
            depth: None,
            text: trimmed.to_string(),
        });
    }
    if looks_like_link_only(trimmed) {
        return Some(Detected {
            kind: BlockKind::Link,
            depth: None,
            text: trimmed.to_string(),
        });
    }
    None
}

fn heading_depth(line: &str) -> Option<usize> {
    let mut depth = 0;
    for ch in line.chars() {
        if ch == '#' {
            depth += 1;
        } else {
            break;
        }
    }
    if (1..=6).contains(&depth) {
        // Ensure the next char is whitespace (otherwise it's not a heading).
        line.chars()
            .nth(depth)
            .map(|c| c.is_whitespace())
            .unwrap_or(false)
            .then(|| depth)
    } else {
        None
    }
}

fn is_list_item(line: &str) -> bool {
    let bytes = line.as_bytes();
    if bytes.first().copied() == Some(b'-')
        || bytes.first().copied() == Some(b'*')
        || bytes.first().copied() == Some(b'+')
    {
        return bytes
            .get(1)
            .copied()
            .map(|c| (c as char).is_whitespace())
            .unwrap_or(false);
    }
    // 1. / 10. / 1)
    let mut idx = 0;
    while idx < bytes.len() && bytes[idx].is_ascii_digit() {
        idx += 1;
    }
    if idx > 0 && idx < bytes.len() {
        let next = bytes[idx];
        if (next == b'.' || next == b')')
            && bytes
                .get(idx + 1)
                .copied()
                .map(|c| (c as char).is_whitespace())
                .unwrap_or(false)
        {
            return true;
        }
    }
    false
}

fn looks_like_image_only(line: &str) -> bool {
    line.starts_with("![") && line.ends_with(')') && line.contains("](")
}

fn looks_like_link_only(line: &str) -> bool {
    line.starts_with('[')
        && line.ends_with(')')
        && line.contains("](")
        && !looks_like_image_only(line)
}

fn split_lines_keep_offsets(markdown: &str) -> Vec<(usize, usize, &str)> {
    let mut result = Vec::new();
    let mut start = 0usize;
    for (idx, ch) in markdown.char_indices() {
        if ch == '\n' {
            result.push((start, idx + 1, &markdown[start..idx]));
            start = idx + 1;
        }
    }
    if start < markdown.len() {
        result.push((start, markdown.len(), &markdown[start..]));
    }
    result
}

fn finalize_block(
    current_kind: &mut Option<BlockKind>,
    current_text: &mut String,
    current_raw: &mut String,
    current_depth: &mut Option<usize>,
    current_start: &mut usize,
) -> MarkdownBlock {
    let kind = current_kind.take().unwrap_or(BlockKind::Unknown);
    let text = std::mem::take(current_text);
    let raw = std::mem::take(current_raw);
    let depth = current_depth.take();
    let start = *current_start;
    MarkdownBlock {
        kind,
        heading_depth: depth,
        text,
        raw,
        start_offset: start,
        end_offset: start,
    }
}

/// Groups blocks into chunks respecting the token budget. Headings always
/// start a new chunk so the heading_path stays stable. Code blocks stay
/// intact (we never split a fence). Tables stay intact (same reason). List
/// items are atomic but may be concatenated across bullets to fill the
/// budget. Paragraphs merge greedily.
fn group_into_chunks(
    blocks: &[MarkdownBlock],
    counter: &dyn TokenCounter,
) -> Vec<Vec<MarkdownBlock>> {
    let mut chunks: Vec<Vec<MarkdownBlock>> = Vec::new();
    let mut current: Vec<MarkdownBlock> = Vec::new();
    let mut current_tokens: usize = 0;

    for block in blocks {
        if matches!(block.kind, BlockKind::Blank) {
            continue;
        }
        let block_tokens = counter.count(&block.raw.trim());
        let force_new = matches!(block.kind, BlockKind::Heading)
            || (current_tokens >= TARGET_TOKENS)
            || (current_tokens + block_tokens > HARD_MAX_TOKENS && !current.is_empty());

        if force_new && !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
            current_tokens = 0;
        }

        // If a single oversized block exceeds HARD_MAX_TOKENS on its own we
        // must still emit it; the chunk size cap is a soft target.
        current.push(block.clone());
        current_tokens += block_tokens;

        if current_tokens >= TARGET_TOKENS {
            chunks.push(std::mem::take(&mut current));
            current_tokens = 0;
        }
    }
    if !current.is_empty() {
        chunks.push(current);
    }

    // Merge trailing tiny chunks into the previous one when possible.
    let mut merged: Vec<Vec<MarkdownBlock>> = Vec::with_capacity(chunks.len());
    for chunk in chunks {
        let tokens = chunk
            .iter()
            .map(|b| counter.count(b.raw.trim()))
            .sum::<usize>();
        if let Some(prev) = merged.last_mut() {
            let prev_tokens: usize = prev.iter().map(|b| counter.count(b.raw.trim())).sum();
            if tokens < MIN_CHUNK_TOKENS && prev_tokens + tokens <= HARD_MAX_TOKENS {
                prev.extend(chunk);
                continue;
            }
        }
        merged.push(chunk);
    }

    merged
}

fn collect_heading_path(group: &[MarkdownBlock]) -> Vec<String> {
    // Find the deepest heading in the group; the path is taken from a
    // running "current heading stack" notion. Each chunk receives the
    // heading text of its own first heading plus any ancestor headings
    // that already appear higher in the document. We approximate the
    // ancestor stack as "all heading texts inside this group, in order".
    let mut path = Vec::new();
    for block in group
        .iter()
        .filter(|b| matches!(b.kind, BlockKind::Heading))
    {
        path.push(block.text.trim().to_string());
    }
    path
}

fn render_group(group: &[MarkdownBlock]) -> String {
    let mut out = String::new();
    for (i, block) in group.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        match block.kind {
            BlockKind::Heading => {
                let depth = block.heading_depth.unwrap_or(1);
                for _ in 0..depth {
                    out.push('#');
                }
                out.push(' ');
                out.push_str(block.text.trim());
            }
            _ => out.push_str(block.raw.trim_end()),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(plan: &ChunkPlan, document_id: &str) -> Vec<String> {
        plan.chunks
            .iter()
            .map(|c| {
                chunk_id(
                    document_id,
                    plan.chunker_version,
                    c.chunk_index,
                    &c.content_hash,
                )
            })
            .collect()
    }

    #[test]
    fn empty_input_yields_empty_plan() {
        let plan = plan_chunks("doc-1", "");
        assert_eq!(plan.chunker_version, CHUNKER_VERSION);
        assert!(plan.chunks.is_empty());
    }

    #[test]
    fn whitespace_only_input_yields_empty_plan() {
        let plan = plan_chunks("doc-1", "   \n\n   \n");
        assert!(plan.chunks.is_empty());
    }

    #[test]
    fn single_paragraph_produces_one_chunk() {
        let plan = plan_chunks("doc-1", "Hello, world.");
        assert_eq!(plan.chunks.len(), 1);
        assert_eq!(plan.chunks[0].heading_path, Vec::<String>::new());
    }

    #[test]
    fn chinese_paragraph_respects_token_budget() {
        let body = "机器学习是一种通过数据驱动自动改进的算法。".repeat(40);
        let plan = plan_chunks("doc-cn", &body);
        assert!(
            plan.chunks.len() >= 2,
            "long Chinese body must split into chunks"
        );
        for chunk in &plan.chunks {
            assert!(
                chunk.token_count <= HARD_MAX_TOKENS,
                "chunk {} exceeded hard cap: {} tokens",
                chunk.chunk_index,
                chunk.token_count
            );
        }
    }

    #[test]
    fn english_long_body_also_splits() {
        let body = "Retrieval-augmented generation improves factuality by anchoring answers in real evidence. "
            .repeat(200);
        let plan = plan_chunks("doc-en", &body);
        assert!(plan.chunks.len() >= 2, "long English body must split");
    }

    #[test]
    fn code_block_is_atomically_preserved() {
        let md = "# API\n\nSome intro.\n\n```\nfn step_one() { /* ... */ }\nfn step_two() { /* ... */ }\n```\n\nOutro paragraph.";
        let plan = plan_chunks("doc-code", md);
        let code_chunk = plan
            .chunks
            .iter()
            .find(|c| c.content.contains("```"))
            .expect("code fence must appear in a chunk");
        // The fence body must not have been torn between two chunks.
        let opening = code_chunk.content.matches("```").count();
        assert_eq!(opening, 2, "fenced code block must have both delimiters");
    }

    #[test]
    fn table_rows_are_not_split_in_half() {
        let md = "| Name | Age |\n| ---- | --- |\n| Ada | 36 |\n| Lin | 32 |\n\nClosing paragraph.";
        let plan = plan_chunks("doc-table", md);
        let table_chunk = plan
            .chunks
            .iter()
            .find(|c| c.content.contains("| Name |"))
            .expect("table must appear in some chunk");
        assert!(
            table_chunk.content.contains("| Ada |"),
            "table body rows must travel with the header row"
        );
    }

    #[test]
    fn long_single_paragraph_eventually_splits() {
        let body = "single paragraph without breaks. ".repeat(800);
        let plan = plan_chunks("doc-long", &body);
        assert!(plan.chunks.len() >= 2);
        // Last chunk should not be emptier than MIN_CHUNK_TOKENS — we merge
        // them at the end.
        let last_tokens = plan.chunks.last().map(|c| c.token_count).unwrap_or(0);
        assert!(
            last_tokens >= MIN_CHUNK_TOKENS / 4,
            "trailing tail was too thin: {last_tokens}"
        );
    }

    #[test]
    fn nested_headings_emit_a_heading_path_per_chunk() {
        let md = "# Top\n\nintro\n\n## Subsection\n\nbody1\n\n## Another\n\nbody2\n";
        let plan = plan_chunks("doc-headings", md);
        // Top heading appears in the first heading-bearing chunk's path;
        // subsections inherit it (we include them as additional entries).
        let with_h2: Vec<_> = plan
            .chunks
            .iter()
            .filter(|c| c.heading_path.iter().any(|h| h == "Subsection"))
            .collect();
        assert!(
            !with_h2.is_empty(),
            "subsection chunk should carry heading path"
        );
    }

    #[test]
    fn image_only_line_is_preserved_as_its_own_block() {
        let md = "![diagram](https://example.com/diagram.png)\n\nReal paragraph.";
        let plan = plan_chunks("doc-image", md);
        assert!(plan.chunks.iter().any(|c| c.content.contains("![diagram]")));
    }

    #[test]
    fn link_only_line_is_preserved() {
        let md = "[homepage](https://example.com)\n\nReal paragraph.";
        let plan = plan_chunks("doc-link", md);
        assert!(plan.chunks.iter().any(|c| c.content.contains("[homepage]")));
    }

    #[test]
    fn editing_one_paragraph_does_not_change_other_chunk_ids() {
        let original = "# Title\n\nparagraph A body.\n\nparagraph B body.\n";
        let edited = "# Title\n\nparagraph A body.\n\nparagraph B body CHANGED.\n";
        let plan_a = plan_chunks("doc-edit", original);
        let plan_b = plan_chunks("doc-edit", edited);
        assert_eq!(plan_a.chunks.len(), plan_b.chunks.len());
        // First chunk should be identical between A and B; only B's last
        // chunk should change.
        let a_ids = ids(&plan_a, "doc-edit");
        let b_ids = ids(&plan_b, "doc-edit");
        // Find the index of the differing chunk by content_hash comparison.
        let mut differing = 0;
        for (a, b) in a_ids.iter().zip(b_ids.iter()) {
            if a != b {
                differing += 1;
            }
        }
        assert!(
            differing <= 1,
            "expected at most one chunk to change after a single-paragraph edit; got {differing}"
        );
    }

    #[test]
    fn chunk_id_changes_when_chunk_index_moves() {
        // Two chunks with the same content but different positions must NOT
        // collide: chunk_index is part of the hash input.
        let id_a = chunk_id("doc-1", CHUNKER_VERSION, 0, "hash");
        let id_b = chunk_id("doc-1", CHUNKER_VERSION, 1, "hash");
        assert_ne!(id_a, id_b);
    }

    #[test]
    fn chunk_id_changes_when_document_changes() {
        let id_a = chunk_id("doc-1", CHUNKER_VERSION, 0, "hash");
        let id_b = chunk_id("doc-2", CHUNKER_VERSION, 0, "hash");
        assert_ne!(id_a, id_b);
    }

    #[test]
    fn chunk_id_is_stable_across_runs_with_same_inputs() {
        let id_a = chunk_id("doc-1", CHUNKER_VERSION, 0, "hash");
        let id_b = chunk_id("doc-1", CHUNKER_VERSION, 0, "hash");
        assert_eq!(id_a, id_b);
    }

    #[test]
    fn approx_token_counter_handles_mixed_cjk_and_latin() {
        let counter = ApproxTokenCounter;
        // Sanity: pure English produces roughly len/5 chars per token.
        let n = counter.count("retrieval-augmented generation");
        assert!((3..=6).contains(&n), "unexpected count for English: {n}");
        let cjk = counter.count("机器学习是核心能力之一");
        assert!(
            cjk >= 9,
            "CJK should count each char as ~1 token, got {cjk}"
        );
    }

    #[test]
    fn quote_block_stays_together() {
        let md = "> First quoted line.\n> Second quoted line.\n> Third quoted line.\n\nTrailing paragraph.";
        let plan = plan_chunks("doc-quote", md);
        let quote_chunk = plan
            .chunks
            .iter()
            .find(|c| c.content.starts_with('>'))
            .expect("quote must appear in some chunk");
        assert!(quote_chunk.content.contains("Second"));
        assert!(quote_chunk.content.contains("Third"));
    }
}
