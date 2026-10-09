//! Production Agent runtime.
//!
//! Batch 1 of the Agent epic shipped only the state-machine and risk enums.
//! Batch 8 supplies:
//! - `runtime` — supervisor + state transitions + recovery
//! - `approval` — argument-hash-bound approvals
//! - `budget` — step / token / cost enforcement
//! - `checkpoint` — JSON snapshot save/restore
//! - `tools` — `AgentTool` trait + registry
//! - `commands` — Tauri surface (`agent_start` / `pause` / `resume` / …)
//!
//! Spec C2 / C6 / C7 / C11 / C12 are addressed here. The full LLM driver
//! stays on the React side via the existing `ai_chat` Tauri command; this
//! runtime owns the *state* and *audit*, the LLM owns the *generation*.

pub mod approval;
pub mod budget;
pub mod checkpoint;
pub mod commands;
pub mod mcp_security;
pub mod runtime;
pub mod security;
pub mod security_commands;
pub mod tools;
pub mod types;

pub use types::{
    AgentStatus, ApprovalStatus, StepStatus, ToolRisk,
};

pub use runtime::{create_run, transition, AgentRunMeta};
