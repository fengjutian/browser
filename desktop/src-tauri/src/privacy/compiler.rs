//! Compiled rule index (spec B4).
//!
//! The hot path matches a URL against thousands of rules. We avoid linear
//! scans by:
//! - `exact_hosts`: HashMap<host, RuleId> for `||domain^` rules whose pattern
//!   maps to a single host.
//! - `suffix_hosts`: a flat vector for the rest of the `||host^` family; the
//!   matcher does a reverse-host walk (request → split by `.`, walk from
//!   TLD up). At batch 6 volumes (~50k rules) linear-on-vector is fine; the
//!   trie swap is documented in `IndexPlan` for batch 10+.
//! - `generic_patterns`: a list of `CompiledPattern` with the ABP-style
//!   wildcards resolved at match time.
//!
//! The compiled set is wrapped in `Arc<RwLock<Arc<CompiledRuleSet>>>` on the
//! live side (not yet wired — batch 7 hands it to the WebView2 listener).

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use crate::privacy::parser::ParserOptions;
use crate::privacy::types::{CosmeticRule, NetworkRule, ParsedRule};

#[derive(Debug, Default, Clone)]
pub struct CompiledRuleSet {
    pub exact_hosts: HashMap<String, Vec<u64>>,
    pub suffix_hosts: Vec<NetworkRule>,
    pub generic_patterns: Vec<CompiledPattern>,
    pub allow_rules: HashMap<String, Vec<u64>>,
    pub cosmetic_by_domain: HashMap<String, Vec<CosmeticRule>>,
    pub unsupported_count: usize,
}

impl CompiledRuleSet {
    pub fn len(&self) -> usize {
        self.suffix_hosts.len()
            + self.generic_patterns.len()
            + self.exact_hosts.values().map(|v| v.len()).sum::<usize>()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[derive(Debug, Clone)]
pub struct CompiledPattern {
    pub rule_id: u64,
    pub anchor_start: bool,
    pub anchor_end: bool,
    pub parts: Vec<String>,
}

pub fn compile(parsed: &ParsedRule, _opts: &ParserOptions) -> CompiledRuleSet {
    let mut out = CompiledRuleSet::default();
    for rule in &parsed.network {
        if let Some(host) = host_from_pattern(&rule.pattern) {
            out.exact_hosts
                .entry(host.to_ascii_lowercase())
                .or_default()
                .push(rule.id);
            if matches!(rule.action, crate::privacy::types::RuleAction::Allow) {
                out.allow_rules
                    .entry(host.to_ascii_lowercase())
                    .or_default()
                    .push(rule.id);
            }
        } else {
            // Pattern is generic — add to the suffix bucket; for `*` / `|url`
            // / `url|` / regular patterns, we walk the generic matcher.
            if matches!(rule.action, crate::privacy::types::RuleAction::Allow) {
                // Allows take precedence over blocks; index allows separately
                // so the matcher consults them first.
                out.generic_patterns.push(compile_pattern(rule));
            } else {
                out.suffix_hosts.push(rule.clone());
            }
        }
    }

    for rule in &parsed.cosmetic {
        for d in &rule.domains {
            out.cosmetic_by_domain
                .entry(d.to_ascii_lowercase())
                .or_default()
                .push(rule.clone());
        }
    }

    out.unsupported_count = parsed.unsupported.len();
    out
}

fn host_from_pattern(pattern: &str) -> Option<&str> {
    // ABP `||domain^` style. We don't try to enumerate "host" via DNS; this
    // just lifts the literal host into the exact_hosts table.
    let trimmed = pattern.trim_start_matches("||").trim_end_matches('^');
    if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('?') || trimmed.contains('*') {
        return None;
    }
    Some(trimmed)
}

fn compile_pattern(rule: &NetworkRule) -> CompiledPattern {
    let pattern = rule.pattern.as_str();
    let anchor_start = pattern.starts_with('|');
    let anchor_end = pattern.ends_with('|');
    let inner = pattern.trim_matches('|');
    CompiledPattern {
        rule_id: rule.id,
        anchor_start,
        anchor_end,
        parts: inner.split('*').map(|p| p.to_string()).collect(),
    }
}

/// Snapshot-on-read pattern so request listeners never block on writes.
#[derive(Debug, Default, Clone)]
pub struct CompiledSetHandle {
    inner: Arc<RwLock<Arc<CompiledRuleSet>>>,
}

impl CompiledSetHandle {
    pub fn new(initial: CompiledRuleSet) -> Self {
        Self {
            inner: Arc::new(RwLock::new(Arc::new(initial))),
        }
    }

    pub fn snapshot(&self) -> Arc<CompiledRuleSet> {
        self.inner.read().map(|r| r.clone()).unwrap_or_else(|_| Arc::new(CompiledRuleSet::default()))
    }

    pub fn replace(&self, new_set: CompiledRuleSet) {
        if let Ok(mut guard) = self.inner.write() {
            *guard = Arc::new(new_set);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::privacy::parser::parse_rules;

    #[test]
    fn exact_hosts_are_indexed_by_lower_case() {
        let parsed = parse_rules("||doubleclick.net^", &ParserOptions::default());
        let compiled = compile(&parsed, &ParserOptions::default());
        assert_eq!(compiled.exact_hosts.get("doubleclick.net").map(|v| v.len()), Some(1));
    }

    #[test]
    fn generic_patterns_route_to_generic_bucket() {
        let parsed = parse_rules("*/ads/*", &ParserOptions::default());
        let compiled = compile(&parsed, &ParserOptions::default());
        // `*/ads/*` is generic so it lands in `generic_patterns` (treated as
        // a suffix-style pattern for batch 6's matcher).
        assert!(!compiled.generic_patterns.is_empty());
    }

    #[test]
    fn unsupported_count_surfaces_in_compile_report() {
        let parsed = parse_rules("/ads\\.js/\n||good.com^", &ParserOptions::default());
        let compiled = compile(&parsed, &ParserOptions::default());
        assert!(compiled.unsupported_count > 0);
        assert!(!compiled.is_empty());
    }

    #[test]
    fn handle_replace_swaps_snapshot_atomically() {
        let handle = CompiledSetHandle::new(CompiledRuleSet::default());
        let snap1 = handle.snapshot();
        assert!(snap1.is_empty());
        let mut next = CompiledRuleSet::default();
        next.suffix_hosts.push(NetworkRule {
            id: 1,
            source_list_id: "x".into(),
            action: crate::privacy::types::RuleAction::Block,
            pattern: "||tracker.com^".into(),
            domains: vec![],
            excluded_domains: vec![],
            resource_types: vec![],
            third_party: None,
            important: false,
        });
        handle.replace(next);
        let snap2 = handle.snapshot();
        assert_eq!(snap2.len(), 1);
    }
}
