//! Production Agent runtime.
//!
//! Batch 1 of the Agent epic ships only the state-machine enums and the
//! lightweight public types they need. The runtime, planner, executor,
//! approval engine and checkpointing logic themselves are scheduled for
//! batches 8–9 and will live in sibling modules of this directory.
//!
//! All types serialise with `snake_case` for the enum variants so the database
//! `status` / `risk_level` columns we just migrated to (`agent_runs`,
//! `agent_tool_calls`, `agent_approvals`) match them verbatim.

pub mod types;

pub use types::{AgentStatus, ApprovalStatus, StepStatus, ToolRisk};
