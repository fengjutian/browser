//! Tauri command bindings for agent security helpers.
//!
//! Two are exposed today:
//! - `agent_detect_injection` — wraps `security::detect` for the UI.
//! - `agent_validate_mcp_url` — wraps `mcp_security::validate_url` so the
//!   settings page can sanity-check user-supplied MCP endpoints before
//!   they hit the `mcp_servers` table.

use super::mcp_security::{validate_url, McpUrlPolicy};
use super::security::{detect, DetectionReport, SourceKind};

#[tauri::command]
pub fn agent_detect_injection(text: String, source: Option<String>) -> DetectionReport {
    let kind = match source.as_deref() {
        Some("user-instruction") => SourceKind::UserInstruction,
        Some("system-policy") => SourceKind::SystemPolicy,
        Some("local-document") => SourceKind::LocalDocument,
        Some("remote-page") => SourceKind::RemotePage,
        Some("mcp-result") => SourceKind::McpResult,
        Some("plugin-result") => SourceKind::PluginResult,
        Some("tool-result") => SourceKind::ToolResult,
        _ => SourceKind::Unknown,
    };
    detect(&text, kind)
}

#[tauri::command]
pub fn agent_validate_mcp_url(
    url: String,
    allow_local: Option<bool>,
) -> Result<bool, String> {
    let policy = McpUrlPolicy {
        allow_local: allow_local.unwrap_or(false),
        allow_private: false,
    };
    validate_url(&url, &policy)
        .map(|_| true)
        .map_err(|e| format!("rejected: {e:?}"))
}
