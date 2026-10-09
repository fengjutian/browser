//! Privacy rule model (spec B1).
//!
//! `RuleAction` and `ResourceType` mirror the spec. `NetworkRule` is parsed
//! from an ABP-style text rule; `CosmeticRule` is the standalone `##selector`
//! / `#@#selector` form.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RuleAction {
    Block,
    Allow,
    Redirect,
    CosmeticHide,
    CosmeticUnhide,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceType {
    Document,
    Script,
    Image,
    Stylesheet,
    XmlHttpRequest,
    SubDocument,
    Font,
    Media,
    WebSocket,
    Other,
}

impl ResourceType {
    pub fn as_token(self) -> &'static str {
        match self {
            Self::Document => "document",
            Self::Script => "script",
            Self::Image => "image",
            Self::Stylesheet => "stylesheet",
            Self::XmlHttpRequest => "xmlhttprequest",
            Self::SubDocument => "subdocument",
            Self::Font => "font",
            Self::Media => "media",
            Self::WebSocket => "websocket",
            Self::Other => "other",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkRule {
    pub id: u64,
    pub source_list_id: String,
    pub action: RuleAction,
    pub pattern: String,
    pub domains: Vec<String>,
    pub excluded_domains: Vec<String>,
    pub resource_types: Vec<ResourceType>,
    pub third_party: Option<bool>,
    pub important: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CosmeticRule {
    pub id: u64,
    pub domains: Vec<String>,
    pub excluded_domains: Vec<String>,
    pub selector: String,
    pub action: RuleAction,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ParsedRule {
    pub network: Vec<NetworkRule>,
    pub cosmetic: Vec<CosmeticRule>,
    pub unsupported: Vec<String>,
}

/// Outcome of a matcher run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchOutcome {
    pub matched: bool,
    pub action: Option<RuleAction>,
    pub rule_id: Option<u64>,
    pub reason: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_type_tokens_are_stable() {
        assert_eq!(ResourceType::Script.as_token(), "script");
        assert_eq!(ResourceType::XmlHttpRequest.as_token(), "xmlhttprequest");
    }

    #[test]
    fn parsed_rule_default_is_empty() {
        let parsed = ParsedRule::default();
        assert!(parsed.network.is_empty());
        assert!(parsed.cosmetic.is_empty());
        assert!(parsed.unsupported.is_empty());
    }
}
