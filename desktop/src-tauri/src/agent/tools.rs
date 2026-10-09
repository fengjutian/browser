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

#[async_trait]
pub trait AgentTool: Send + Sync {
    fn definition(&self) -> ToolDefinition;
    fn risk(&self, _args: &serde_json::Value) -> ToolRisk {
        self.definition().default_risk
    }
    fn validate(&self, args: &serde_json::Value) -> Result<(), ToolError>;
    async fn execute(&self, ctx: ToolContext, args: serde_json::Value)
        -> Result<ToolResult, ToolError>;
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
        Self { tools: HashMap::new() }
    }

    pub fn register(&mut self, tool: Arc<dyn AgentTool>) {
        let def = tool.definition();
        self.tools.insert(def.name.clone(), tool);
    }

    pub fn get(&self, name: &str) -> Option<Arc<dyn AgentTool>> {
        self.tools.get(name).cloned()
    }

    pub fn definitions(&self) -> Vec<ToolDefinition> {
        let mut out: Vec<ToolDefinition> =
            self.tools.values().map(|t| t.definition()).collect();
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
}
