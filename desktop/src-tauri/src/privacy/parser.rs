//! ABP-style rule parser (spec B1). Supports the limited subset the spec
//! requires; unsupported rules are tracked in `unsupported` so a compile
//! report can surface the count.

use crate::privacy::types::{CosmeticRule, NetworkRule, ParsedRule, ResourceType, RuleAction};

#[derive(Debug, Default)]
pub struct ParserOptions {
    pub source_list_id: String,
    pub next_id: u64,
}

pub fn parse_rules(text: &str, opts: &ParserOptions) -> ParsedRule {
    let mut out = ParsedRule::default();
    let mut next_id = opts.next_id;
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('!') || line.starts_with('[') {
            // Comment / metadata like `[Adblock Plus 2.0]`.
            continue;
        }
        // Cosmetic rule form
        if let Some(rest) = line.strip_prefix("##") {
            next_id += 1;
            let sel = rest.trim().to_string();
            if sel.is_empty() {
                out.unsupported.push(line.to_string());
                continue;
            }
            out.cosmetic.push(CosmeticRule {
                id: next_id,
                domains: Vec::new(),
                excluded_domains: Vec::new(),
                selector: sel,
                action: RuleAction::CosmeticHide,
            });
            continue;
        }
        if let Some(rest) = line.strip_prefix("#@#") {
            next_id += 1;
            let sel = rest.trim().to_string();
            if sel.is_empty() {
                out.unsupported.push(line.to_string());
                continue;
            }
            out.cosmetic.push(CosmeticRule {
                id: next_id,
                domains: Vec::new(),
                excluded_domains: Vec::new(),
                selector: sel,
                action: RuleAction::CosmeticUnhide,
            });
            continue;
        }

        // Network rule
        let mut raw = line;
        let mut action = RuleAction::Block;
        if let Some(rest) = raw.strip_prefix("@@") {
            action = RuleAction::Allow;
            raw = rest;
        }

        let (pattern_part, modifiers_part) = match raw.rsplit_once('$') {
            Some((p, m)) if !p.contains('$') => (p, m),
            _ => (raw, ""),
        };

        let pattern = pattern_part.trim();
        if pattern.is_empty() {
            out.unsupported.push(line.to_string());
            continue;
        }

        let mut resource_types: Vec<ResourceType> = Vec::new();
        let mut third_party: Option<bool> = None;
        let mut important = false;
        let mut domains: Vec<String> = Vec::new();
        let mut excluded_domains: Vec<String> = Vec::new();

        for token in modifiers_part.split(',').filter(|t| !t.is_empty()) {
            let token = token.trim();
            if token.is_empty() {
                continue;
            }
            if token == "third-party" {
                third_party = Some(true);
                continue;
            }
            if token == "first-party" || token == "~third-party" {
                third_party = Some(false);
                continue;
            }
            if token == "important" {
                important = true;
                continue;
            }
            if let Some(domain_list) = token.strip_prefix("domain=") {
                for d in domain_list.split('|') {
                    if let Some(stripped) = d.strip_prefix('~') {
                        excluded_domains.push(stripped.to_ascii_lowercase());
                    } else {
                        domains.push(d.to_ascii_lowercase());
                    }
                }
                continue;
            }
            match token {
                "script" => resource_types.push(ResourceType::Script),
                "image" => resource_types.push(ResourceType::Image),
                "stylesheet" => resource_types.push(ResourceType::Stylesheet),
                "xmlhttprequest" => resource_types.push(ResourceType::XmlHttpRequest),
                "subdocument" => resource_types.push(ResourceType::SubDocument),
                "font" => resource_types.push(ResourceType::Font),
                "media" => resource_types.push(ResourceType::Media),
                "websocket" => resource_types.push(ResourceType::WebSocket),
                "document" => resource_types.push(ResourceType::Document),
                "object" | "object-subrequest" | "ping" | "other" => {
                    resource_types.push(ResourceType::Other)
                }
                _ => {
                    out.unsupported.push(line.to_string());
                }
            }
        }

        // Unsupported pattern forms (regex, generic anchor without `*`,
        // domain-anchored rules that we don't compile yet).
        if pattern.starts_with('/') && pattern.ends_with('/') && pattern.len() > 2 {
            out.unsupported.push(line.to_string());
            continue;
        }

        next_id += 1;
        out.network.push(NetworkRule {
            id: next_id,
            source_list_id: opts.source_list_id.clone(),
            action,
            pattern: pattern.to_string(),
            domains,
            excluded_domains,
            resource_types,
            third_party,
            important,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opt() -> ParserOptions {
        ParserOptions {
            source_list_id: "test".into(),
            next_id: 0,
        }
    }

    #[test]
    fn parses_simple_domain_anchor() {
        let rules = parse_rules("||doubleclick.net^", &opt());
        assert_eq!(rules.network.len(), 1);
        assert_eq!(rules.network[0].pattern, "||doubleclick.net^");
        assert!(rules.unsupported.is_empty());
    }

    #[test]
    fn parses_allow_rule() {
        let rules = parse_rules("@@||trusted.example^", &opt());
        assert_eq!(rules.network[0].action, RuleAction::Allow);
    }

    #[test]
    fn parses_resource_type_modifiers() {
        let rules = parse_rules("||tracker.example^$third-party,script,image", &opt());
        let r = &rules.network[0];
        assert_eq!(r.third_party, Some(true));
        assert!(r.resource_types.contains(&ResourceType::Script));
        assert!(r.resource_types.contains(&ResourceType::Image));
    }

    #[test]
    fn parses_domain_and_excluded_domain() {
        let rules = parse_rules("||foo.com^$domain=example.com|~sub.example.com", &opt());
        let r = &rules.network[0];
        assert!(r.domains.iter().any(|d| d == "example.com"));
        assert!(r.excluded_domains.iter().any(|d| d == "sub.example.com"));
    }

    #[test]
    fn parses_cosmetic_hide_and_unhide() {
        let rules = parse_rules("##.ad\n#@#.allow-ad", &opt());
        assert_eq!(rules.cosmetic.len(), 2);
        assert_eq!(rules.cosmetic[0].action, RuleAction::CosmeticHide);
        assert_eq!(rules.cosmetic[1].action, RuleAction::CosmeticUnhide);
    }

    #[test]
    fn flags_unsupported_regex() {
        let rules = parse_rules("/ads\\.js/", &opt());
        assert_eq!(rules.unsupported.len(), 1);
        assert!(rules.network.is_empty());
    }

    #[test]
    fn skips_comments_and_metadata() {
        let rules = parse_rules("! comment\n[Adblock Plus 2.0]\n||a.com^", &opt());
        assert_eq!(rules.network.len(), 1);
        assert_eq!(rules.unsupported.len(), 0);
    }

    #[test]
    fn important_modifier_is_preserved() {
        let rules = parse_rules("||blocked.example^$important", &opt());
        assert!(rules.network[0].important);
    }
}
