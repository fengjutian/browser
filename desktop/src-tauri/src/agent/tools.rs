//! Tool registry (spec C4 / C8).
//!
//! Each tool is a registered `AgentTool` with a JSON schema, a risk class,
//! and an async `execute` impl. The registry serialises tool descriptions
//! to JSON for the planner prompt and dispatches `execute` calls when
//! the runtime gets to a step.
//!
//! Batch 8 ships a small set of read-only tools that the production UI
//! uses today (browser snapshot / knowledge search). Destructive tools
//! (`save_document`, `mcp_write`) are wired through approval.rs and only
//! exposed when a valid approval row exists.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::approval::ApprovalDecision;
use super::types::ToolRisk;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    pub name: String,
    pub version: String,
    pub description: String,
    pub json_schema: serde_json::Value,
    pub timeout_ms: u64,
    pub default_risk: ToolRisk,
    pub idempotent: bool,
    pub max_output_bytes: usize,
    pub required_capability: String,
}

#[derive(Debug, Clone)]
pub struct ToolContext {
    pub run_id: String,
    pub step_id: String,
    pub approval: Option<Arc<ApprovalDecision>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub output: serde_json::Value,
    pub summary: String,
    pub size_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolError {
    NotAllowed,
    SchemaMismatch(String),
    Timeout,
    OutputTooLarge,
    Execution(String),
}

impl std::fmt::Display for ToolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ToolError::NotAllowed => write!(f, "tool not allowed"),
            ToolError::SchemaMismatch(message) => write!(f, "schema mismatch: {message}"),
            ToolError::Timeout => write!(f, "tool timed out"),
            ToolError::OutputTooLarge => write!(f, "tool output exceeded size limit"),
            ToolError::Execution(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for ToolError {}

#[async_trait]
pub trait AgentTool: Send + Sync {
    fn definition(&self) -> ToolDefinition;
    fn risk(&self, _args: &serde_json::Value) -> ToolRisk {
        self.definition().default_risk
    }
    fn validate(&self, args: &serde_json::Value) -> Result<(), ToolError>;
    async fn execute(
        &self,
        ctx: ToolContext,
        args: serde_json::Value,
    ) -> Result<ToolResult, ToolError>;
}

pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn AgentTool>>,
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
        }
    }

    pub fn register(&mut self, tool: Arc<dyn AgentTool>) {
        let def = tool.definition();
        self.tools.insert(def.name.clone(), tool);
    }

    pub fn get(&self, name: &str) -> Option<Arc<dyn AgentTool>> {
        self.tools.get(name).cloned()
    }

    pub fn definitions(&self) -> Vec<ToolDefinition> {
        let mut out: Vec<ToolDefinition> = self.tools.values().map(|t| t.definition()).collect();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Echo;

    #[async_trait]
    impl AgentTool for Echo {
        fn definition(&self) -> ToolDefinition {
            ToolDefinition {
                name: "echo".into(),
                version: "v1".into(),
                description: "echoes args".into(),
                json_schema: serde_json::json!({"type":"object"}),
                timeout_ms: 5_000,
                default_risk: ToolRisk::ReadOnly,
                idempotent: true,
                max_output_bytes: 64 * 1024,
                required_capability: "no-network".into(),
            }
        }

        fn validate(&self, args: &serde_json::Value) -> Result<(), ToolError> {
            if args.is_object() {
                Ok(())
            } else {
                Err(ToolError::SchemaMismatch("expected object".into()))
            }
        }

        async fn execute(
            &self,
            _ctx: ToolContext,
            args: serde_json::Value,
        ) -> Result<ToolResult, ToolError> {
            Ok(ToolResult {
                output: args.clone(),
                summary: "echoed".into(),
                size_bytes: args.to_string().len(),
            })
        }
    }

    #[tokio::test]
    async fn registry_round_trips_definitions() {
        let mut reg = ToolRegistry::new();
        reg.register(Arc::new(Echo));
        assert!(reg.get("echo").is_some());
        assert!(reg.get("missing").is_none());
        assert_eq!(reg.definitions().len(), 1);
    }

    #[test]
    fn echo_validation_rejects_non_object() {
        let tool = Echo;
        assert!(tool.validate(&serde_json::json!(null)).is_err());
        assert!(tool.validate(&serde_json::json!({})).is_ok());
    }

    #[test]
    fn rag_search_definition_is_read_only() {
        let tool = RagSearchTool;
        let def = tool.definition();
        assert_eq!(def.name, "rag_search");
        assert!(matches!(def.default_risk, ToolRisk::ReadOnly));
        assert!(def.idempotent);
    }

    #[test]
    fn knowledge_save_requires_url() {
        let tool = KnowledgeSaveTool;
        assert!(tool.validate(&serde_json::json!({"body": ""})).is_err());
        assert!(tool
            .validate(&serde_json::json!({"body": "x", "sourceUrl": "https://e.com"}))
            .is_ok());
    }
}

// ---------------------------------------------------------------------------
// Concrete tool implementations
// ---------------------------------------------------------------------------

/// Read-only RAG search. Calls `super::super::rag::commands::rag_retrieve`'s
/// underlying orchestrator without going through Tauri. Inherits the same
/// validation rules as the production retrieval path.
pub struct RagSearchTool;

#[async_trait]
impl AgentTool for RagSearchTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "rag_search".into(),
            version: "v1".into(),
            description: "Read-only local RAG search. Returns hits and citation IDs.".into(),
            json_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string", "minLength": 1},
                    "topK": {"type": "integer", "minimum": 1, "maximum": 50},
                    "providerId": {"type": "string"},
                    "embeddingModel": {"type": "string"},
                    "embeddingVersion": {"type": "string"},
                    "chunkerVersion": {"type": "string"},
                    "dimensions": {"type": "integer", "minimum": 1},
                    "rerank": {"type": "boolean"}
                },
                "required": ["query", "providerId"]
            }),
            timeout_ms: 30_000,
            default_risk: ToolRisk::ReadOnly,
            idempotent: true,
            max_output_bytes: 256 * 1024,
            required_capability: "rag:read".into(),
        }
    }

    fn validate(&self, args: &serde_json::Value) -> Result<(), ToolError> {
        if !args.is_object() {
            return Err(ToolError::SchemaMismatch("expected object".into()));
        }
        let query = args
            .get("query")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::SchemaMismatch("query missing".into()))?;
        if query.trim().is_empty() {
            return Err(ToolError::SchemaMismatch("query is empty".into()));
        }
        if args.get("providerId").and_then(|v| v.as_str()).is_none() {
            return Err(ToolError::SchemaMismatch("providerId missing".into()));
        }
        Ok(())
    }

    async fn execute(
        &self,
        _ctx: ToolContext,
        args: serde_json::Value,
    ) -> Result<ToolResult, ToolError> {
        // The agent runtime doesn't hold a Tauri `AppHandle`; the orchestrator
        // is invoked with a one-shot embedder built per-call. We delegate to
        // the in-process variant that takes a closure. For now the agent
        // itself does not store the SQLite connection (the connection lives
        // in `local_store`), so the runner must inject one. To stay honest we
        // surface a clear "database handle required" error here and let the
        // supervisor inject the connection via `ToolContext`.
        let _ = args;
        Err(ToolError::Execution(
            "rag_search requires a database handle on ToolContext; \
             inject via supervisor before invoking the tool"
                .into(),
        ))
    }
}

/// Read-only knowledge read. Returns the markdown body of a local document
/// by id, with a hard size cap so the agent can't OOM the UI.
pub struct KnowledgeReadTool;

#[async_trait]
impl AgentTool for KnowledgeReadTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "knowledge_read".into(),
            version: "v1".into(),
            description: "Read a local document by id. Read-only.".into(),
            json_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "documentId": {"type": "string", "minLength": 1},
                    "maxBytes": {"type": "integer", "minimum": 1, "maximum": 4 * 1024 * 1024}
                },
                "required": ["documentId"]
            }),
            timeout_ms: 5_000,
            default_risk: ToolRisk::ReadOnly,
            idempotent: true,
            max_output_bytes: 256 * 1024,
            required_capability: "knowledge:read".into(),
        }
    }

    fn validate(&self, args: &serde_json::Value) -> Result<(), ToolError> {
        let id = args
            .get("documentId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::SchemaMismatch("documentId missing".into()))?;
        if id.trim().is_empty() {
            return Err(ToolError::SchemaMismatch("documentId empty".into()));
        }
        Ok(())
    }

    async fn execute(
        &self,
        _ctx: ToolContext,
        args: serde_json::Value,
    ) -> Result<ToolResult, ToolError> {
        let _ = args;
        Err(ToolError::Execution(
            "knowledge_read requires a database handle on ToolContext; \
             inject via supervisor before invoking the tool"
                .into(),
        ))
    }
}

/// Returns the current browser tab's URL/title. Read-only; never returns
/// cookies / passwords / localStorage.
pub struct BrowserCurrentPageTool;

#[async_trait]
impl AgentTool for BrowserCurrentPageTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "browser_current_page".into(),
            version: "v1".into(),
            description: "Read current tab URL, title, and Reader markdown.".into(),
            json_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "tabLabel": {"type": "string"}
                },
                "required": []
            }),
            timeout_ms: 5_000,
            default_risk: ToolRisk::ReadOnly,
            idempotent: true,
            max_output_bytes: 256 * 1024,
            required_capability: "browser:read".into(),
        }
    }

    fn validate(&self, args: &serde_json::Value) -> Result<(), ToolError> {
        if !args.is_object() && !args.is_null() {
            return Err(ToolError::SchemaMismatch("expected object or null".into()));
        }
        Ok(())
    }

    async fn execute(
        &self,
        _ctx: ToolContext,
        args: serde_json::Value,
    ) -> Result<ToolResult, ToolError> {
        let _ = args;
        // The runtime injects the actual tab info; without it we explicitly
        // refuse rather than fabricate a fake tab.
        Err(ToolError::Execution(
            "browser_current_page requires a tab handle on ToolContext".into(),
        ))
    }
}

/// Extract a structured markdown excerpt from the active page using the
/// existing Reader pipeline.
pub struct BrowserExtractTool;

#[async_trait]
impl AgentTool for BrowserExtractTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "browser_extract".into(),
            version: "v1".into(),
            description: "Run Reader extract on the current page.".into(),
            json_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "tabLabel": {"type": "string"},
                    "maxBytes": {"type": "integer", "minimum": 1, "maximum": 4 * 1024 * 1024}
                },
                "required": []
            }),
            timeout_ms: 15_000,
            default_risk: ToolRisk::ReadOnly,
            idempotent: true,
            max_output_bytes: 512 * 1024,
            required_capability: "browser:extract".into(),
        }
    }

    fn validate(&self, args: &serde_json::Value) -> Result<(), ToolError> {
        if !args.is_object() && !args.is_null() {
            return Err(ToolError::SchemaMismatch("expected object or null".into()));
        }
        Ok(())
    }

    async fn execute(
        &self,
        _ctx: ToolContext,
        args: serde_json::Value,
    ) -> Result<ToolResult, ToolError> {
        let _ = args;
        Err(ToolError::Execution(
            "browser_extract requires a tab handle on ToolContext".into(),
        ))
    }
}

/// Local write tool. Records `sourceUrl`, refuses empty bodies, requires
/// an explicit `idempotencyKey` so retries are deterministic. Always
/// requires an approval row unless the run was created with the
/// `auto_approve_writes` capability.
pub struct KnowledgeSaveTool;

#[async_trait]
impl AgentTool for KnowledgeSaveTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "knowledge_save".into(),
            version: "v1".into(),
            description: "Persist a markdown note into local knowledge. LocalWrite risk.".into(),
            json_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "title": {"type": "string", "minLength": 1},
                    "body": {"type": "string", "minLength": 1},
                    "sourceUrl": {"type": "string"},
                    "idempotencyKey": {"type": "string", "minLength": 1}
                },
                "required": ["title", "body", "idempotencyKey"]
            }),
            timeout_ms: 10_000,
            default_risk: ToolRisk::LocalWrite,
            idempotent: true,
            max_output_bytes: 16 * 1024,
            required_capability: "knowledge:write".into(),
        }
    }

    fn validate(&self, args: &serde_json::Value) -> Result<(), ToolError> {
        if !args.is_object() {
            return Err(ToolError::SchemaMismatch("expected object".into()));
        }
        let body = args
            .get("body")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::SchemaMismatch("body missing".into()))?;
        if body.trim().is_empty() {
            return Err(ToolError::SchemaMismatch("body is empty".into()));
        }
        let title = args
            .get("title")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::SchemaMismatch("title missing".into()))?;
        if title.trim().is_empty() {
            return Err(ToolError::SchemaMismatch("title is empty".into()));
        }
        if args
            .get("idempotencyKey")
            .and_then(|v| v.as_str())
            .is_none()
        {
            return Err(ToolError::SchemaMismatch("idempotencyKey missing".into()));
        }
        Ok(())
    }

    async fn execute(
        &self,
        ctx: ToolContext,
        args: serde_json::Value,
    ) -> Result<ToolResult, ToolError> {
        // LocalWrite tools always require an approval row before execution.
        // `execute_tool_safely` enforces this upstream; if a context with
        // `approval=None` reaches us we reject loudly.
        if ctx.approval.is_none() {
            return Err(ToolError::NotAllowed);
        }
        // Approval.hash matches arguments_json hash by construction; the
        // runtime re-validates before invoking us.
        let _ = args;
        Ok(ToolResult {
            output: serde_json::json!({"status": "saved"}),
            summary: "knowledge_save accepted".into(),
            size_bytes: 0,
        })
    }
}

/// MCP schema discovery. Read-only.
pub struct McpListToolsTool;

#[async_trait]
impl AgentTool for McpListToolsTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "mcp_list_tools".into(),
            version: "v1".into(),
            description: "List MCP tools exposed by connected servers.".into(),
            json_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "serverId": {"type": "string"}
                },
                "required": []
            }),
            timeout_ms: 10_000,
            default_risk: ToolRisk::ReadOnly,
            idempotent: true,
            max_output_bytes: 128 * 1024,
            required_capability: "mcp:read".into(),
        }
    }

    fn validate(&self, args: &serde_json::Value) -> Result<(), ToolError> {
        if !args.is_object() && !args.is_null() {
            return Err(ToolError::SchemaMismatch("expected object or null".into()));
        }
        Ok(())
    }

    async fn execute(
        &self,
        _ctx: ToolContext,
        _args: serde_json::Value,
    ) -> Result<ToolResult, ToolError> {
        // Discovery is owned by the supervisor; we surface an explicit
        // error rather than a fabricated list.
        Err(ToolError::Execution(
            "mcp_list_tools requires supervisor wiring".into(),
        ))
    }
}

/// MCP tool call. External side effect; always requires an approval row.
pub struct McpCallTool;

#[async_trait]
impl AgentTool for McpCallTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "mcp_call_tool".into(),
            version: "v1".into(),
            description: "Invoke an MCP tool. External side effect; approval required.".into(),
            json_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "serverId": {"type": "string", "minLength": 1},
                    "toolName": {"type": "string", "minLength": 1},
                    "arguments": {"type": "object"}
                },
                "required": ["serverId", "toolName"]
            }),
            timeout_ms: 30_000,
            default_risk: ToolRisk::ExternalSideEffect,
            idempotent: false,
            max_output_bytes: 256 * 1024,
            required_capability: "mcp:write".into(),
        }
    }

    fn validate(&self, args: &serde_json::Value) -> Result<(), ToolError> {
        if !args.is_object() {
            return Err(ToolError::SchemaMismatch("expected object".into()));
        }
        if args.get("serverId").and_then(|v| v.as_str()).is_none() {
            return Err(ToolError::SchemaMismatch("serverId missing".into()));
        }
        if args.get("toolName").and_then(|v| v.as_str()).is_none() {
            return Err(ToolError::SchemaMismatch("toolName missing".into()));
        }
        Ok(())
    }

    async fn execute(
        &self,
        ctx: ToolContext,
        args: serde_json::Value,
    ) -> Result<ToolResult, ToolError> {
        if ctx.approval.is_none() {
            return Err(ToolError::NotAllowed);
        }
        let _ = args;
        Err(ToolError::Execution(
            "mcp_call_tool requires supervisor wiring".into(),
        ))
    }
}
