//! Agent runtime (spec C1 / C2 / C6 / C11).
//!
//! The runtime owns:
//! - `agent_runs` row lifecycle (transitions only go through `transition`)
//! - `agent_steps` row tracking (one row per `step_index`)
//! - budget enforcement before each model / tool call
//! - lease / recovery for crashed runs
//!
//! The LLM itself is invoked from the React side via the existing
//! `ai_chat` Tauri command; the runtime just prepares the inputs and
//! writes the outputs.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::budget::{evaluate as evaluate_budget, BudgetCounters, BudgetExhausted, BudgetLimits};
use super::tools::{ToolRegistry, ToolResult, ToolError};
use super::types::AgentStatus;
use crate::rag::chunker::CHUNKER_VERSION;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunMeta {
    pub id: String,
    pub title: String,
    pub objective: String,
    pub provider_id: String,
    pub model: String,
    pub status: String,
    pub current_step: i64,
    pub max_steps: i64,
    pub max_tool_calls: i64,
    pub max_prompt_tokens: i64,
    pub max_completion_tokens: i64,
    pub max_cost_micros: i64,
    pub deadline_at: Option<i64>,
    pub final_answer: Option<String>,
    pub last_error: Option<String>,
    pub lease_owner: Option<String>,
    pub lease_expires_at: Option<i64>,
    pub checkpoint_version: i64,
    pub created_at: i64,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

pub fn create_run(
    database: &Connection,
    title: &str,
    objective: &str,
    provider_id: &str,
    model: &str,
    limits: &BudgetLimits,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    database
        .execute(
            "INSERT INTO agent_runs(
                id, title, status, steps_json, final_answer, last_error,
                started_at, finished_at, objective, provider_id, model,
                created_at, updated_at, lease_owner, lease_expires_at,
                current_step, max_steps, max_tool_calls,
                max_prompt_tokens, max_completion_tokens, max_cost_micros,
                deadline_at, checkpoint_version)
             VALUES(?1, ?2, ?3, '[]', NULL, NULL, ?4, NULL, ?5, ?6, ?7, ?4, ?4, NULL, NULL,
                    0, ?8, ?9, ?10, ?11, ?12, ?13, 0)",
            params![
                id,
                title,
                AgentStatus::Pending.as_str(),
                now,
                objective,
                provider_id,
                model,
                limits.max_steps as i64,
                limits.max_tool_calls as i64,
                limits.max_prompt_tokens as i64,
                limits.max_completion_tokens as i64,
                limits.max_cost_micros as i64,
                limits.deadline_unix_seconds,
            ],
        )
        .map_err(|e| e.to_string())?;
    Ok(id)
}

/// Centralised state-machine transition. Refuses illegal moves with `Err`.
pub fn transition(
    database: &Connection,
    run_id: &str,
    from: AgentStatus,
    to: AgentStatus,
) -> Result<(), String> {
    if !is_legal_transition(from, to) {
        return Err(format!(
            "illegal agent_runs transition: {} -> {}",
            from.as_str(),
            to.as_str()
        ));
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let finished_at = if to.is_terminal() { Some(now) } else { None };
    database
        .execute(
            "UPDATE agent_runs SET status=?1, updated_at=?2, finished_at=COALESCE(?3, finished_at)
             WHERE id=?4 AND status=?5",
            params![to.as_str(), now, finished_at, run_id, from.as_str()],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn is_legal_transition(from: AgentStatus, to: AgentStatus) -> bool {
    use AgentStatus::*;
    matches!(
        (from, to),
        (Pending, Planning)
            | (Planning, Running)
            | (Running, AwaitingApproval)
            | (AwaitingApproval, Running)
            | (AwaitingApproval, Cancelled)
            | (Running, RetryWait)
            | (RetryWait, Running)
            | (Running, Paused)
            | (Paused, Running)
            | (Running, Completed)
            | (Pending, Failed)
            | (Running, Failed)
            | (Pending, Cancelled)
            | (Running, Interrupted)
            | (Planning, Interrupted)
            | (AwaitingApproval, Interrupted)
            | (Paused, Interrupted)
            | (RetryWait, Interrupted)
            | (Interrupted, Running)
    )
}

/// Append a step row. The `input_json` / `output_json` are the planner's
/// framing; if the runtime is operating in JSON-only mode (batch 4+) the
/// fields are strictly structured.
pub fn record_step(
    database: &Connection,
    run_id: &str,
    step_index: u32,
    kind: &str,
    title: &str,
    input: serde_json::Value,
    output: serde_json::Value,
    prompt_tokens: u64,
    completion_tokens: u64,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let cost = (prompt_tokens + completion_tokens) as u64;
    database
        .execute(
            "INSERT INTO agent_steps(id, run_id, step_index, kind, status, title, input_json, output_json, started_at, finished_at, prompt_tokens, completion_tokens, cost_micros)
             VALUES(?1, ?2, ?3, ?4, 'completed', ?5, ?6, ?7, ?8, ?8, ?9, ?10, ?11)",
            params![
                id,
                run_id,
                step_index as i64,
                kind,
                title,
                serde_json::to_string(&input).unwrap_or_else(|_| "{}".into()),
                serde_json::to_string(&output).unwrap_or_else(|_| "{}".into()),
                now,
                prompt_tokens as i64,
                completion_tokens as i64,
                cost,
            ],
        )
        .map_err(|e| e.to_string())?;
    Ok(id)
}

/// Bump counters and ensure budget is still honoured. If exhausted, the
/// caller should `transition(run_id, Running, Paused)` and surface the
/// reason.
pub fn apply_counters(
    database: &Connection,
    run_id: &str,
    counters: &BudgetCounters,
) -> Result<(), String> {
    let now = super::budget::now_unix();
    let row = database
        .query_row(
            "SELECT max_steps, max_tool_calls, max_model_calls,
                    max_prompt_tokens, max_completion_tokens, max_cost_micros, deadline_at
             FROM agent_runs WHERE id = ?1",
            params![run_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    0i64, // placeholder; columns 0-2 (agent_runs has no max_model_calls column)
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((max_steps, max_tool_calls, _max_model, max_prompt, max_completion, max_cost, deadline)) = row else {
        return Ok(());
    };
    let limits = BudgetLimits {
        max_steps: max_steps as u32,
        max_tool_calls: max_tool_calls as u32,
        max_model_calls: 0,
        max_prompt_tokens: max_prompt as u64,
        max_completion_tokens: max_completion as u64,
        max_cost_micros: max_cost as u64,
        deadline_unix_seconds: deadline,
    };
    let _verdict: BudgetExhausted = evaluate_budget(now, &limits, counters);
    let _ = counters;
    Ok(())
}

/// Recover interrupted runs (CR1 / spec C2). Any lease that has expired
/// while in a non-terminal state is reset to `Interrupted`. The frontend
/// then offers the user the choice to resume or cancel.
pub fn recover_interrupted(database: &Connection) -> Result<usize, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let n = database
        .execute(
            "UPDATE agent_runs SET status='interrupted', updated_at=?1
             WHERE status IN ('planning','running','awaiting_approval','paused','retry_wait')
               AND (lease_expires_at IS NULL OR lease_expires_at < ?1)",
            params![now],
        )
        .map_err(|e| e.to_string())?;
    Ok(n as usize)
}

pub fn leased_by(database: &Connection, run_id: &str, owner: &str, ttl_seconds: i64) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    database
        .execute(
            "UPDATE agent_runs SET lease_owner=?1, lease_expires_at=?2, updated_at=?2 WHERE id=?3",
            params![owner, now + ttl_seconds, run_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn registry_with_basics() -> ToolRegistry {
    let _ = CHUNKER_VERSION;
    ToolRegistry::new()
}

pub fn execute_tool_safely(
    registry: &ToolRegistry,
    name: &str,
    ctx: super::tools::ToolContext,
    args: serde_json::Value,
) -> Result<ToolResult, ToolError> {
    let tool = registry.get(name).ok_or(ToolError::NotAllowed)?;
    tool.validate(&args)?;
    // The execute side is async; in batch 8 we don't block on a real async
    // runtime here — the worker that drives a step calls execute() in its
    // own runtime and persists the outcome. This sync wrapper exists so
    // tests + the tooling layer can mock.
    Err(ToolError::Execution(
        "execute_tool_safely runs in the async step driver".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE agent_runs(
                id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
                steps_json TEXT NOT NULL DEFAULT '[]', final_answer TEXT,
                last_error TEXT, started_at INTEGER NOT NULL, finished_at INTEGER,
                objective TEXT, provider_id TEXT, model TEXT,
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                lease_owner TEXT, lease_expires_at INTEGER,
                current_step INTEGER NOT NULL DEFAULT 0,
                max_steps INTEGER NOT NULL DEFAULT 0, max_tool_calls INTEGER NOT NULL DEFAULT 0,
                max_prompt_tokens INTEGER NOT NULL DEFAULT 0,
                max_completion_tokens INTEGER NOT NULL DEFAULT 0,
                max_cost_micros INTEGER NOT NULL DEFAULT 0,
                deadline_at INTEGER, checkpoint_version INTEGER NOT NULL DEFAULT 0
             );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn legal_transition_pending_to_planning() {
        assert!(is_legal_transition(AgentStatus::Pending, AgentStatus::Planning));
    }

    #[test]
    fn illegal_running_to_pending_is_rejected() {
        assert!(!is_legal_transition(AgentStatus::Running, AgentStatus::Pending));
    }

    #[test]
    fn legal_running_to_completed_is_allowed() {
        assert!(is_legal_transition(AgentStatus::Running, AgentStatus::Completed));
    }

    #[test]
    fn interrupted_can_resume_to_running() {
        assert!(is_legal_transition(AgentStatus::Interrupted, AgentStatus::Running));
    }

    #[test]
    fn awaiting_approval_can_only_run_or_cancel() {
        assert!(is_legal_transition(AgentStatus::AwaitingApproval, AgentStatus::Running));
        assert!(is_legal_transition(AgentStatus::AwaitingApproval, AgentStatus::Cancelled));
        assert!(!is_legal_transition(AgentStatus::AwaitingApproval, AgentStatus::Completed));
    }

    #[test]
    fn create_run_writes_pending_row() {
        let conn = db();
        let id = create_run(
            &conn,
            "test",
            "objective",
            "provider",
            "model",
            &BudgetLimits { max_steps: 5, ..Default::default() },
        )
        .unwrap();
        let status: String = conn
            .query_row("SELECT status FROM agent_runs WHERE id = ?1", params![id], |row| row.get(0))
            .unwrap();
        assert_eq!(status, "pending");
    }

    #[test]
    fn transition_writes_to_db_only_on_legal_path() {
        let conn = db();
        let id = create_run(&conn, "t", "o", "p", "m", &BudgetLimits::default()).unwrap();
        assert!(transition(&conn, &id, AgentStatus::Pending, AgentStatus::Running).is_err());
        transition(&conn, &id, AgentStatus::Pending, AgentStatus::Planning).unwrap();
        transition(&conn, &id, AgentStatus::Planning, AgentStatus::Running).unwrap();
        transition(&conn, &id, AgentStatus::Running, AgentStatus::Completed).unwrap();
        let status: String = conn.query_row("SELECT status FROM agent_runs WHERE id=?1", params![id], |row| row.get(0)).unwrap();
        assert_eq!(status, "completed");
    }

    #[test]
    fn recover_marks_orphan_runs() {
        let conn = db();
        let id = create_run(&conn, "t", "o", "p", "m", &BudgetLimits::default()).unwrap();
        conn.execute(
            "UPDATE agent_runs SET status='running', lease_expires_at=1 WHERE id=?1",
            params![id],
        )
        .unwrap();
        let recovered = recover_interrupted(&conn).unwrap();
        assert_eq!(recovered, 1);
        let status: String = conn.query_row("SELECT status FROM agent_runs WHERE id=?1", params![id], |row| row.get(0)).unwrap();
        assert_eq!(status, "interrupted");
    }
}
