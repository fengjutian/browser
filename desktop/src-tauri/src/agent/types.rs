//! Agent state-machine and risk enums.
//!
//! The corresponding database columns were widened in migration 24
//! (`agent_runs.status`, `agent_tool_calls.risk_level`,
//! `agent_approvals.status`) so the values produced by these enums must stay
//! in lock-step with the SQL `CHECK` constraints — changing a variant here
//! without a follow-up migration will break inserts.
//!
//! `AgentStatus::parse` is the single entry point the runtime uses to decode
//! rows coming back from SQLite; it returns `None` for unknown values so the
//! supervisor can decide whether to surface the error or migrate the row.

use serde::{Deserialize, Serialize};

/// Lifecycle states for an agent run. The transitions are centralised in the
/// runtime (batch 8); this enum is just the data definition.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Pending,
    Planning,
    Running,
    AwaitingApproval,
    Paused,
    RetryWait,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

impl AgentStatus {
    /// Stable string used in `agent_runs.status` (matches the SQL CHECK list).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Planning => "planning",
            Self::Running => "running",
            Self::AwaitingApproval => "awaiting_approval",
            Self::Paused => "paused",
            Self::RetryWait => "retry_wait",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Interrupted => "interrupted",
        }
    }

    /// Decode a value previously emitted by `as_str()`. Returns `None` for
    /// anything unknown so the caller can decide whether to upgrade the row
    /// in place or treat it as data corruption.
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "pending" => Self::Pending,
            "planning" => Self::Planning,
            "running" => Self::Running,
            "awaiting_approval" => Self::AwaitingApproval,
            "paused" => Self::Paused,
            "retry_wait" => Self::RetryWait,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            "interrupted" => Self::Interrupted,
            _ => return None,
        })
    }

    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Cancelled | Self::Interrupted
        )
    }
}

/// Status of a single step within a run. Kept distinct from `AgentStatus`
/// so the UI can render "step X is running" without overloading the run-level
/// status.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    Running,
    AwaitingApproval,
    Completed,
    Failed,
    Cancelled,
}

impl StepStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::AwaitingApproval => "awaiting_approval",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

/// Risk classification for a tool call. Drives both the approval policy and
/// whether a non-idempotent call may auto-retry on crash.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ToolRisk {
    ReadOnly,
    LocalWrite,
    NetworkRead,
    NetworkWrite,
    ExternalSideEffect,
    Destructive,
}

impl ToolRisk {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReadOnly => "read_only",
            Self::LocalWrite => "local_write",
            Self::NetworkRead => "network_read",
            Self::NetworkWrite => "network_write",
            Self::ExternalSideEffect => "external_side_effect",
            Self::Destructive => "destructive",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "read_only" => Self::ReadOnly,
            "local_write" => Self::LocalWrite,
            "network_read" => Self::NetworkRead,
            "network_write" => Self::NetworkWrite,
            "external_side_effect" => Self::ExternalSideEffect,
            "destructive" => Self::Destructive,
            _ => return None,
        })
    }

    /// Conservative default for crash recovery: only `ReadOnly` is treated as
    /// safely retryable. Everything else must be queried or escalated.
    pub fn is_safe_to_auto_retry(self) -> bool {
        matches!(self, Self::ReadOnly)
    }
}

/// Approval states. Persisted on `agent_approvals.status` with a CHECK that
/// mirrors these variants exactly.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Denied,
    Expired,
    Cancelled,
}

impl ApprovalStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Approved => "APPROVED",
            Self::Denied => "DENIED",
            Self::Expired => "EXPIRED",
            Self::Cancelled => "CANCELLED",
        }
    }

    /// Match the column's CHECK list — note `as_str` returns upper-case to
    /// stay consistent with the existing SQL convention (`PENDING` etc.).
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "PENDING" => Self::Pending,
            "APPROVED" => Self::Approved,
            "DENIED" => Self::Denied,
            "EXPIRED" => Self::Expired,
            "CANCELLED" => Self::Cancelled,
            _ => return None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_status_round_trips_for_every_variant() {
        for status in [
            AgentStatus::Pending,
            AgentStatus::Planning,
            AgentStatus::Running,
            AgentStatus::AwaitingApproval,
            AgentStatus::Paused,
            AgentStatus::RetryWait,
            AgentStatus::Completed,
            AgentStatus::Failed,
            AgentStatus::Cancelled,
            AgentStatus::Interrupted,
        ] {
            let raw = status.as_str();
            assert_eq!(AgentStatus::parse(raw), Some(status));
            let json = serde_json::to_string(&status).unwrap();
            let back: AgentStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(back, status);
        }
    }

    #[test]
    fn agent_status_parses_unknown_as_none() {
        assert_eq!(AgentStatus::parse("not-a-status"), None);
        assert_eq!(AgentStatus::parse(""), None);
    }

    #[test]
    fn only_terminal_statuses_are_reported_terminal() {
        assert!(!AgentStatus::Pending.is_terminal());
        assert!(!AgentStatus::Running.is_terminal());
        assert!(!AgentStatus::Planning.is_terminal());
        assert!(AgentStatus::Completed.is_terminal());
        assert!(AgentStatus::Failed.is_terminal());
        assert!(AgentStatus::Cancelled.is_terminal());
        assert!(AgentStatus::Interrupted.is_terminal());
    }

    #[test]
    fn tool_risk_safe_to_auto_retry_is_conservative() {
        assert!(ToolRisk::ReadOnly.is_safe_to_auto_retry());
        for r in [
            ToolRisk::LocalWrite,
            ToolRisk::NetworkRead,
            ToolRisk::NetworkWrite,
            ToolRisk::ExternalSideEffect,
            ToolRisk::Destructive,
        ] {
            assert!(
                !r.is_safe_to_auto_retry(),
                "only ReadOnly should auto-retry, {r:?} must not"
            );
        }
    }

    #[test]
    fn approval_status_matches_sql_check_conventions() {
        // The schema CHECK uses upper-case string literals; make sure both
        // directions of conversion match them exactly.
        for status in [
            ApprovalStatus::Pending,
            ApprovalStatus::Approved,
            ApprovalStatus::Denied,
            ApprovalStatus::Expired,
            ApprovalStatus::Cancelled,
        ] {
            let raw = status.as_str();
            assert_eq!(ApprovalStatus::parse(raw), Some(status));
        }
        assert_eq!(ApprovalStatus::parse("pending"), None);
    }
}
