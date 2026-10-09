//! Snapshot checkpoint (spec C12).
//!
//! Each successful step writes one checkpoint row so that:
//! - completed steps don't repeat on resume;
//! - read-only tool calls can be safely re-driven;
//! - non-idempotent in-flight calls become `UNKNOWN` and require user input
//!   before the run resumes.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointState {
    pub objective: String,
    pub plan_summary: String,
    pub current_step: u32,
    pub completed_steps: Vec<String>,
    pub pending_actions: Vec<String>,
    pub tool_call_statuses: std::collections::HashMap<String, String>,
    pub budget_used: super::budget::BudgetCounters,
    pub last_model_output_hash: Option<String>,
    pub evidence_ids: Vec<String>,
    pub pending_approvals: Vec<String>,
    pub created_at: i64,
}

pub fn save(database: &Connection, run_id: &str, state: &CheckpointState) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let json = serde_json::to_string(state).map_err(|e| e.to_string())?;
    database
        .execute(
            "INSERT INTO agent_checkpoints(id, run_id, step_index, state_json, created_at)
             VALUES(?1, ?2, ?3, ?4, ?5)",
            params![id, run_id, state.current_step as i64, json, state.created_at],
        )
        .map_err(|e| e.to_string())?;
    // Bump `checkpoint_version` on the run.
    database
        .execute(
            "UPDATE agent_runs SET checkpoint_version = checkpoint_version + 1, updated_at=?1 WHERE id=?2",
            params![state.created_at, run_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(id)
}

pub fn latest_for_run(database: &Connection, run_id: &str) -> Result<Option<CheckpointState>, String> {
    let row: Option<(String, i64)> = database
        .query_row(
            "SELECT state_json, created_at FROM agent_checkpoints
             WHERE run_id = ?1 ORDER BY created_at DESC LIMIT 1",
            params![run_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((json, _created)) = row else { return Ok(None) };
    let state: CheckpointState = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(Some(state))
}

pub fn should_replay_read_only(tool_call_status: &str) -> bool {
    tool_call_status == "PENDING"
}

pub fn mark_unknown_runners(database: &Connection, run_id: &str) -> Result<usize, String> {
    let updated = database
        .execute(
            "UPDATE agent_tool_calls SET status='UNKNOWN'
             WHERE run_id=?1 AND status IN ('PENDING','RUNNING')",
            params![run_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(updated as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_state() -> CheckpointState {
        CheckpointState {
            objective: "obj".into(),
            plan_summary: "plan".into(),
            current_step: 1,
            completed_steps: vec!["s1".into()],
            pending_actions: vec![],
            tool_call_statuses: Default::default(),
            budget_used: Default::default(),
            last_model_output_hash: Some("h".into()),
            evidence_ids: vec![],
            pending_approvals: vec![],
            created_at: 0,
        }
    }

    #[test]
    fn checkpoint_state_round_trips_via_serde() {
        let state = empty_state();
        let json = serde_json::to_string(&state).unwrap();
        let parsed: CheckpointState = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.current_step, 1);
        assert_eq!(parsed.completed_steps, vec!["s1".to_string()]);
    }

    #[test]
    fn should_replay_read_only_only_for_pending_calls() {
        assert!(should_replay_read_only("PENDING"));
        assert!(!should_replay_read_only("COMPLETED"));
        assert!(!should_replay_read_only("RUNNING"));
    }
}
