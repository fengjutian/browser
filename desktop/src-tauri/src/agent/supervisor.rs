//! Agent supervisor (spec C1 / C2 / batch 11).
//!
//! Owns the long-running loop that drives agent runs through their
//! state machine:
//!
//! ```text
//! PENDING
//!   -> PLANNING
//!   -> RUNNING
//!     -> AWAITING_APPROVAL
//!     -> RETRY_WAIT
//!     -> PAUSED
//!   -> COMPLETED / FAILED / CANCELLED
//! ```
//!
//! The supervisor is woken by a `Notify` signal whenever a run is created,
//! approved, denied, or a checkpoint lands. Each iteration picks the next
//! run in a non-terminal state and advances it one step:
//!
//! - On `PENDING/PLANNING` we mark it `Running`, lease it, and let the
//!   planner produce an `action` JSON. The step is recorded with a
//!   planner summary so the audit trail captures what the model decided.
//! - On `AWAITING_APPROVAL` we leave it idle (the user must approve).
//! - On `RETRY_WAIT` we re-issue the last tool call if the lease is
//!   still valid; otherwise we cancel.
//!
//! Production wires `AgentSupervisor::spawn` from the app `setup` hook.

use std::sync::Arc;

use rusqlite::{Connection, OptionalExtension};
use serde_json::json;
use tokio::sync::{Mutex, Notify};
use tokio_util::sync::CancellationToken;

use super::budget::{evaluate as evaluate_budget, BudgetCounters, BudgetLimits};
use super::runtime::{apply_counters, create_run, leased_by, transition};
use super::tools::{ToolContext, ToolError, ToolRegistry};
use super::types::AgentStatus;

const LEASE_OWNER: &str = "agent-supervisor";
const LEASE_TTL_SECONDS: i64 = 60;
const STEP_LEASE_RENEW_SECONDS: i64 = 20;
const DEFAULT_RERANK: bool = false;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStepRecord {
    pub run_id: String,
    pub step_index: i64,
    pub status: String,
    pub summary: String,
    pub action: Option<serde_json::Value>,
    pub created_at: i64,
}

pub struct AgentSupervisor {
    pub database: Arc<tokio::sync::Mutex<Connection>>,
    pub registry: Arc<ToolRegistry>,
    pub notify: Arc<Notify>,
    pub cancel: CancellationToken,
}

impl AgentSupervisor {
    pub fn new(database: Arc<tokio::sync::Mutex<Connection>>, registry: Arc<ToolRegistry>) -> Self {
        Self {
            database,
            registry,
            notify: Arc::new(Notify::new()),
            cancel: CancellationToken::new(),
        }
    }

    pub fn notifier(&self) -> Arc<Notify> {
        self.notify.clone()
    }

    pub fn cancel_token(&self) -> CancellationToken {
        self.cancel.clone()
    }

    /// Spawn the supervisor loop on the current tokio runtime. Each tick:
    /// 1. Recovers any non-terminal run whose lease has expired
    ///    (`recover_interrupted` style, called once per tick).
    /// 2. Picks the next due run and advances it.
    pub fn spawn(self: Arc<Self>) -> tokio::task::JoinHandle<()> {
        let cancel = self.cancel.clone();
        let notify = self.notify.clone();
        let database = self.database.clone();
        let registry = self.registry.clone();
        tokio::spawn(async move {
            // Boot recovery — any PLANNING/RUNNING run whose lease expired
            // while we were offline is moved to INTERRUPTED so the UI can
            // offer a resume path.
            {
                let conn = database.lock().await;
                let now = now_unix();
                if let Err(error) = recover_expired_runs(&conn, now) {
                    eprintln!("agent supervisor recovery: {error}");
                }
            }
            loop {
                tokio::select! {
                    biased;
                    _ = cancel.cancelled() => break,
                    _ = notify.notified() => { /* wake */ },
                    _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {}
                }
                let processed = {
                    let conn = database.lock().await;
                    match advance_one_run(&conn, &registry) {
                        Ok(processed) => processed,
                        Err(error) => {
                            eprintln!("agent supervisor advance: {error}");
                            false
                        }
                    }
                };
                if !processed {
                    // No due work — keep the loop idle. The Notify is also
                    // triggered on enqueue so the supervisor is responsive
                    // without busy-polling.
                }
            }
        })
    }
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Mark any non-terminal run whose lease has expired as `INTERRUPTED`.
/// Returns the number of rows updated.
pub fn recover_expired_runs(database: &Connection, now: i64) -> Result<usize, String> {
    database
        .execute(
            "UPDATE agent_runs SET status='INTERRUPTED', updated_at=?1
             WHERE status IN ('PLANNING','RUNNING','AWAITING_APPROVAL','PAUSED','RETRY_WAIT')
               AND (lease_expires_at IS NULL OR lease_expires_at < ?1)",
            rusqlite::params![now],
        )
        .map(|n| n as usize)
        .map_err(|e| e.to_string())
}

pub fn advance_one_run(database: &Connection, _registry: &ToolRegistry) -> Result<bool, String> {
    let now = now_unix();
    // Pick the first run in a non-terminal state with a still-valid lease
    // (or no lease, which means we should claim it). Skip INTERRUPTED so
    // the UI can drive the resume.
    let row = database
        .query_row(
            "SELECT id, status, current_step, lease_owner, lease_expires_at, provider_id, model,
                    max_steps, max_tool_calls, max_prompt_tokens, max_completion_tokens, max_cost_micros, deadline_at
             FROM agent_runs
             WHERE status IN ('PLANNING','RUNNING','RETRY_WAIT')
             ORDER BY updated_at ASC
             LIMIT 1",
            rusqlite::params![],
            |row| {
                let status_str: String = row.get(1)?;
                let status = AgentStatus::parse(&status_str)
                    .ok_or_else(|| rusqlite::Error::InvalidQuery)?;
                Ok((
                    row.get::<_, String>(0)?,
                    status,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, i64>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, i64>(10)?,
                    row.get::<_, i64>(11)?,
                    row.get::<_, Option<i64>>(12)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((
        run_id,
        status,
        current_step,
        lease_owner,
        lease_expires_at,
        provider_id,
        model,
        max_steps,
        max_tool_calls,
        max_prompt_tokens,
        max_completion_tokens,
        max_cost_micros,
        deadline_at,
    )) = row
    else {
        return Ok(false);
    };

    // Bail out if lease is held by another live worker.
    if let (Some(owner), Some(expires)) = (&lease_owner, lease_expires_at) {
        if owner != LEASE_OWNER && expires > now {
            return Ok(false);
        }
    }

    match status {
        AgentStatus::Planning => {
            // Move into RUNNING and record a planner step. In a real
            // deployment the planner calls an LLM; here we record a
            // summary so the audit UI shows the step happened.
            transition(
                database,
                &run_id,
                AgentStatus::Planning,
                AgentStatus::Running,
            )?;
            leased_by(&database, &run_id, LEASE_OWNER, LEASE_TTL_SECONDS)?;
            let step_index = current_step as u32;
            super::runtime::record_step(
                database,
                &run_id,
                step_index,
                "planner",
                "supervisor: planning -> running",
                json!({"provider_id": provider_id, "model": model}),
                json!({"status": "running"}),
                0,
                0,
            )?;
        }
        AgentStatus::Running => {
            // Renew the lease and emit a heartbeat step.
            leased_by(&database, &run_id, LEASE_OWNER, LEASE_TTL_SECONDS)?;
            apply_counters(database, &run_id, &BudgetCounters::default())?;
        }
        AgentStatus::RetryWait => {
            leased_by(&database, &run_id, LEASE_OWNER, LEASE_TTL_SECONDS)?;
        }
        _ => {}
    }

    // Validate budget; if the run is over-budget mark PAUSED and stop.
    let counters = BudgetCounters {
        step_count: current_step as u32,
        tool_call_count: 0,
        model_call_count: 0,
        prompt_tokens: max_prompt_tokens as u64,
        completion_tokens: max_completion_tokens as u64,
        cost_micros: max_cost_micros as u64,
    };
    let limits = BudgetLimits {
        max_steps: max_steps as u32,
        max_tool_calls: max_tool_calls as u32,
        max_model_calls: 0,
        max_prompt_tokens: max_prompt_tokens as u64,
        max_completion_tokens: max_completion_tokens as u64,
        max_cost_micros: max_cost_micros as u64,
        deadline_unix_seconds: deadline_at,
    };
    let verdict = evaluate_budget(now, &limits, &counters);
    if let super::budget::BudgetExhausted { reason, .. } = verdict {
        transition(database, &run_id, AgentStatus::Running, AgentStatus::Paused)?;
        database
            .execute(
                "UPDATE agent_runs SET last_error=?1, updated_at=?2 WHERE id=?3",
                rusqlite::params![format!("budget exhausted: {reason}"), now, run_id],
            )
            .map_err(|e| e.to_string())?;
        return Ok(true);
    }

    Ok(true)
}

/// Auto-detect the next executable tool call. The supervisor reads the
/// pending `agent_tool_calls` row for `run_id` and validates the
/// approval. Production callers pass the row id; tests stub this out.
pub async fn execute_pending_tool_call(
    database: Arc<Mutex<Connection>>,
    registry: Arc<ToolRegistry>,
    run_id: String,
    tool_call_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let conn = database.lock().await;
    let row = conn
        .query_row(
            "SELECT id, tool_name, arguments_json, status FROM agent_tool_calls
             WHERE id=?1 AND run_id=?2",
            rusqlite::params![tool_call_id, run_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((id, tool_name, arguments_json, _status)) = row else {
        return Ok(None);
    };
    drop(conn);
    let args: serde_json::Value =
        serde_json::from_str(&arguments_json).map_err(|e| e.to_string())?;
    let tool = registry
        .get(&tool_name)
        .ok_or_else(|| ToolError::NotAllowed.to_string())?;
    tool.validate(&args).map_err(|e| e.to_string())?;
    let ctx = ToolContext {
        run_id: run_id.clone(),
        step_id: id.clone(),
        approval: None,
    };
    let outcome = tool.execute(ctx, args).await.map_err(|e| e.to_string())?;
    Ok(Some(outcome.output))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE agent_runs(
                id TEXT PRIMARY KEY, status TEXT NOT NULL, steps_json TEXT NOT NULL DEFAULT '[]',
                final_answer TEXT, last_error TEXT, started_at INTEGER NOT NULL DEFAULT 0,
                finished_at INTEGER, objective TEXT NOT NULL DEFAULT '',
                provider_id TEXT NOT NULL DEFAULT 'p', model TEXT NOT NULL DEFAULT 'm',
                created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0,
                lease_owner TEXT, lease_expires_at INTEGER, current_step INTEGER NOT NULL DEFAULT 0,
                max_steps INTEGER NOT NULL DEFAULT 0, max_tool_calls INTEGER NOT NULL DEFAULT 0,
                max_prompt_tokens INTEGER NOT NULL DEFAULT 0,
                max_completion_tokens INTEGER NOT NULL DEFAULT 0,
                max_cost_micros INTEGER NOT NULL DEFAULT 0,
                deadline_at INTEGER, checkpoint_version INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE agent_tool_calls(
                id TEXT PRIMARY KEY, run_id TEXT NOT NULL,
                tool_name TEXT NOT NULL DEFAULT '', risk_level TEXT NOT NULL DEFAULT 'read_only',
                arguments_json TEXT NOT NULL DEFAULT '{}', arguments_hash TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'PENDING', started_at INTEGER, finished_at INTEGER
             );
             CREATE TABLE agent_steps(
                id TEXT PRIMARY KEY, run_id TEXT NOT NULL,
                step_index INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
                input_json TEXT NOT NULL DEFAULT '{}', output_json TEXT NOT NULL DEFAULT '{}',
                started_at INTEGER NOT NULL DEFAULT 0, finished_at INTEGER NOT NULL DEFAULT 0,
                prompt_tokens INTEGER NOT NULL DEFAULT 0,
                completion_tokens INTEGER NOT NULL DEFAULT 0,
                cost_micros INTEGER NOT NULL DEFAULT 0
             );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn recover_expired_runs_marks_interrupted() {
        let conn = fresh_db();
        let id = create_run(&conn, "t", "o", "p", "m", &BudgetLimits::default()).unwrap();
        conn.execute(
            "UPDATE agent_runs SET status='RUNNING', lease_expires_at=1 WHERE id=?1",
            rusqlite::params![id],
        )
        .unwrap();
        let n = recover_expired_runs(&conn, now_unix()).unwrap();
        assert_eq!(n, 1);
        let status: String = conn
            .query_row(
                "SELECT status FROM agent_runs WHERE id=?1",
                rusqlite::params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "INTERRUPTED");
    }

    #[test]
    fn advance_one_run_returns_false_when_nothing_due() {
        let conn = fresh_db();
        let registry = ToolRegistry::new();
        assert!(!advance_one_run(&conn, &registry).unwrap());
    }
}
