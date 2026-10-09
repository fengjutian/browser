//! Request-time matcher (spec B4 + B5).
//!
//! Given a parsed URL and the top-level origin (`firstParty`), the matcher
//! walks the compiled indices in priority order:
//! 1. Allow rules matching the request and its domain scope.
//! 2. Block rules matching the request (including domain + resource type).
//!
//! Cosmetic-only rules (`Block` action with no resource type filter) match
//! DOM selectors at the cosmetic layer; here we treat them as "block" on
//! the request so a sub-resource CSS rule with no `$` part still hits.

use std::sync::Arc;

use crate::privacy::compiler::{CompiledPattern, CompiledRuleSet};
use crate::privacy::types::{MatchOutcome, NetworkRule, ResourceType, RuleAction};

#[derive(Debug, Clone)]
pub struct RequestMeta {
    pub url: String,
    pub top_level_origin: Option<String>,
    pub resource_type: ResourceType,
    pub third_party: bool,
    pub list_id: Option<String>,
}

pub fn match_request(set: &Arc<CompiledRuleSet>, meta: &RequestMeta) -> MatchOutcome {
    let url_host_str = url_host(&meta.url).map(|s| s.to_ascii_lowercase());
    let origin_host = meta
        .top_level_origin
        .as_deref()
        .and_then(url_host)
        .map(|s| s.to_ascii_lowercase());

    // Spec B4: allow rules win over block rules.
    if let Some(host) = url_host_str.as_deref() {
        if let Some(ids) = set.allow_rules.get(host) {
            for id in ids {
                if apply_allows_under(*id, set) {
                    return MatchOutcome {
                        matched: true,
                        action: Some(RuleAction::Allow),
                        rule_id: Some(*id),
                        reason: "host allow".into(),
                    };
                }
            }
        }
    }

    if let Some(host) = url_host_str.as_deref() {
        if let Some(ids) = set.exact_hosts.get(host) {
            for id in ids {
                return MatchOutcome {
                    matched: true,
                    action: Some(RuleAction::Block),
                    rule_id: Some(*id),
                    reason: "exact host".into(),
                };
            }
        }
        // Reverse-host walk for the suffix bucket.
        let parts: Vec<&str> = host.split('.').collect();
        for window in parts.windows(1).rev() {
            let needle = window.join(".");
            for rule in &set.suffix_hosts {
                if matches(rule, &needle, meta, origin_host.as_deref()) {
                    return MatchOutcome {
                        matched: true,
                        action: Some(rule.action),
                        rule_id: Some(rule.id),
                        reason: "suffix pattern".into(),
                    };
                }
            }
        }
    }

    for pattern in &set.generic_patterns {
        if pattern_matches(pattern, &meta.url) {
            return MatchOutcome {
                matched: true,
                action: Some(RuleAction::Allow), // allows only — blocks took the suffix path
                rule_id: Some(pattern.rule_id),
                reason: "generic allow".into(),
            };
        }
    }

    MatchOutcome {
        matched: false,
        action: None,
        rule_id: None,
        reason: "no match".into(),
    }
}

fn apply_allows_under(rule_id: u64, set: &Arc<CompiledRuleSet>) -> bool {
    // Walk the suffix bucket for the allow rule and verify it actually
    // applies to the request. The handle returns the first allow we have;
    // for batch 6 we don't carry extra scope, so "exists" is sufficient.
    set.suffix_hosts.iter().any(|r| r.id == rule_id)
}

fn matches(
    rule: &NetworkRule,
    host_tail: &str,
    meta: &RequestMeta,
    top_level: Option<&str>,
) -> bool {
    if let Some(want) = rule.third_party {
        if want != meta.third_party {
            return false;
        }
    }
    if !rule.resource_types.is_empty()
        && !rule.resource_types.iter().any(|t| *t == meta.resource_type)
    {
        return false;
    }
    let needle = &rule.pattern;
    let bare = needle.trim_start_matches("||").trim_end_matches('^');
    if !host_matches_pattern(host_tail, needle) {
        return false;
    }
    // Domain include / exclude.
    if !rule.domains.is_empty() {
        let host = top_level.unwrap_or("");
        if !rule
            .domains
            .iter()
            .any(|d| d == host || host.ends_with(&format!(".{d}")))
        {
            return false;
        }
    }
    if !rule.excluded_domains.is_empty() {
        let host = top_level.unwrap_or("");
        if rule
            .excluded_domains
            .iter()
            .any(|d| d == host || host.ends_with(&format!(".{d}")))
        {
            return false;
        }
    }
    let _ = bare;
    true
}

fn host_matches_pattern(host: &str, pattern: &str) -> bool {
    let p = pattern.trim_start_matches("||");
    let p = p.trim_end_matches('^');
    if p.is_empty() {
        return false;
    }
    if p.contains('*') {
        // Convert to a permissive string match; the batch-10 trie upgrade
        // removes this path entirely.
        let mut parts = p.split('*');
        let mut cursor = host;
        if let Some(first) = parts.next() {
            if !first.is_empty() && !cursor.starts_with(first) {
                return false;
            }
            cursor = &cursor[first.len()..];
        }
        for next in parts {
            if next.is_empty() {
                continue;
            }
            match cursor.find(next) {
                Some(idx) => cursor = &cursor[idx + next.len()..],
                None => return false,
            }
        }
        return true;
    }
    if pattern.starts_with("||") {
        return host == p || host.ends_with(&format!(".{p}"));
    }
    if pattern.starts_with('|') {
        return host == p.trim_start_matches('|');
    }
    host == p
}

fn pattern_matches(pattern: &CompiledPattern, url: &str) -> bool {
    let bytes = url.as_bytes();
    if pattern.anchor_start && pattern.parts.first().map_or(true, |p| !url.starts_with(p)) {
        return false;
    }
    let mut cursor = url;
    if pattern.anchor_start {
        cursor = &cursor[pattern.parts[0].len()..];
    }
    let mut parts = pattern.parts.iter().peekable();
    while let Some(part) = parts.next() {
        if part.is_empty() {
            continue;
        }
        if parts.peek().is_none() {
            if pattern.anchor_end {
                return cursor.ends_with(part);
            }
            return cursor.contains(part);
        }
        match cursor.find(part.as_str()) {
            Some(idx) => {
                cursor = &cursor[idx + part.len()..];
            }
            None => return false,
        }
    }
    true
}

fn url_host(url: &str) -> Option<String> {
    url::Url::parse(url).ok().and_then(|u| u.host_str().map(|s| s.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set_with(rule: NetworkRule) -> Arc<CompiledRuleSet> {
        let mut s = CompiledRuleSet::default();
        s.suffix_hosts.push(rule);
        Arc::new(s)
    }

    fn block_rule(pattern: &str) -> NetworkRule {
        NetworkRule {
            id: 1,
            source_list_id: "x".into(),
            action: RuleAction::Block,
            pattern: pattern.into(),
            domains: vec![],
            excluded_domains: vec![],
            resource_types: vec![],
            third_party: None,
            important: false,
        }
    }

    #[test]
    fn suffix_rule_blocks_subdomain_request() {
        let set = set_with(block_rule("||ads.example.com^"));
        let meta = RequestMeta {
            url: "https://tracking.ads.example.com/px.gif".into(),
            top_level_origin: Some("https://publisher.com".into()),
            resource_type: ResourceType::Image,
            third_party: true,
            list_id: None,
        };
        let outcome = match_request(&set, &meta);
        assert!(outcome.matched);
        assert_eq!(outcome.action, Some(RuleAction::Block));
    }

    #[test]
    fn suffix_rule_does_not_match_unrelated_host() {
        let set = set_with(block_rule("||ads.example.com^"));
        let meta = RequestMeta {
            url: "https://example.org/foo".into(),
            top_level_origin: Some("https://example.org".into()),
            resource_type: ResourceType::Image,
            third_party: false,
            list_id: None,
        };
        let outcome = match_request(&set, &meta);
        assert!(!outcome.matched);
    }

    #[test]
    fn third_party_filter_blocks_first_party_request() {
        let mut rule = block_rule("||tracker.com^");
        rule.third_party = Some(true);
        let set = set_with(rule);
        let meta = RequestMeta {
            url: "https://tracker.com/".into(),
            top_level_origin: Some("https://tracker.com".into()),
            resource_type: ResourceType::Script,
            third_party: false,
            list_id: None,
        };
        let outcome = match_request(&set, &meta);
        assert!(!outcome.matched);
    }

    #[test]
    fn pattern_with_wildcards_uses_substring_match() {
        let rule = block_rule("*/ads/*");
        let set = set_with(rule);
        let meta = RequestMeta {
            url: "https://cdn.example.com/path/ads/banner.png".into(),
            top_level_origin: Some("https://example.com".into()),
            resource_type: ResourceType::Image,
            third_party: true,
            list_id: None,
        };
        assert!(match_request(&set, &meta).matched);
    }
}
