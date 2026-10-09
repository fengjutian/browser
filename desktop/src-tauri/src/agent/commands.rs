//! Tauri commands for the agent runtime.

use rusqlite::{Connection, OptionalExtension};
use tauri::AppHandle;

use crate::local_store;

use super::approval::{
    decide as approval_decide, hash_arguments, request_approval, verify, ApprovalDecision,
};
use super::budget::BudgetLimits;
use super::checkpoint::{
    latest_for_run, mark_unknown_runners, save as save_checkpoint, CheckpointState,
};
use super::runtime::{
    create_run as runtime_create_run, leased_by, record_step, recover_interrupted, transition,
    AgentRunMeta,
};
use super::types::{AgentStatus, ApprovalStatus};

#[tauri::command]
pub fn agent_recover_interrupted(app: AppHandle) -> Result<usize, String> {
    let database = local_store::connection(&app)?;
    recover_interrupted(&database)
}

#[tauri::command]
pub fn agent_start(
    app: AppHandle,
    title: String,
    objective: String,
    provider_id: String,
    model: String,
    limits: BudgetLimits,
) -> Result<String, String> {
    let database = local_store::connection(&app)?;
    let id = runtime_create_run(&database, &title, &objective, &provider_id, &model, &limits)?;
    transition(&database, &id, AgentStatus::Pending, AgentStatus::Planning)?;
    leased_by(&database, &id, "tauri-main", 60)?;
    Ok(id)
}

#[tauri::command]
pub fn agent_pause(app: AppHandle, run_id: String) -> Result<(), String> {
    let database = local_store::connection(&app)?;
    transition(
        &database,
        &run_id,
        AgentStatus::Running,
        AgentStatus::Paused,
    )
}

#[tauri::command]
pub fn agent_resume(app: AppHandle, run_id: String) -> Result<(), String> {
    let database = local_store::connection(&app)?;
    transition(
        &database,
        &run_id,
        AgentStatus::Paused,
        AgentStatus::Running,
    )
}

#[tauri::command]
pub fn agent_cancel(app: AppHandle, run_id: String) -> Result<(), String> {
    let database = local_store::connection(&app)?;
    let current = current_status(&database, &run_id)?;
    if let Some(from) = current {
        // Best-effort cancel from any non-terminal state.
        let _ = transition(&database, &run_id, from, AgentStatus::Cancelled);
    }
    Ok(())
}

#[tauri::command]
pub fn agent_get_run(app: AppHandle, run_id: String) -> Result<Option<AgentRunMeta>, String> {
    let database = local_store::connection(&app)?;
    let row: Option<(String, String, String, String, String, String, i64, i64, i64, i64, i64, i64, Option<i64>, Option<String>, Option<String>, Option<String>, Option<i64>, i64, i64, i64, Option<i64>)> = database
        .query_row(
            "SELECT id, title, objective, provider_id, model, status, current_step,
                    max_steps, max_tool_calls, max_prompt_tokens, max_completion_tokens, max_cost_micros,
                    deadline_at, final_answer, last_error, lease_owner, lease_expires_at,
                    checkpoint_version, created_at, started_at, finished_at
             FROM agent_runs WHERE id = ?1",
            rusqlite::params![run_id],
            |row| Ok((
                row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?,
                row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?, row.get(10)?, row.get(11)?,
                row.get(12)?, row.get(13)?, row.get(14)?, row.get(15)?, row.get(16)?,
                row.get(17)?, row.get(18)?, row.get(19)?, row.get(20)?
            )),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(row.map(|r| AgentRunMeta {
        id: r.0,
        title: r.1,
        objective: r.2,
        provider_id: r.3,
        model: r.4,
        status: r.5,
        current_step: r.6,
        max_steps: r.7,
        max_tool_calls: r.8,
        max_prompt_tokens: r.9,
        max_completion_tokens: r.10,
        max_cost_micros: r.11,
        deadline_at: r.12,
        final_answer: r.13,
        last_error: r.14,
        lease_owner: r.15,
        lease_expires_at: r.16,
        checkpoint_version: r.17,
        created_at: r.18,
        started_at: r.19,
        finished_at: r.20,
    }))
}

#[tauri::command]
pub fn agent_record_step(
    app: AppHandle,
    run_id: String,
    step_index: i64,
    kind: String,
    title: String,
    input: serde_json::Value,
    output: serde_json::Value,
    prompt_tokens: i64,
    completion_tokens: i64,
) -> Result<String, String> {
    let database = local_store::connection(&app)?;
    record_step(
        &database,
        &run_id,
        step_index as u32,
        &kind,
        &title,
        input,
        output,
        prompt_tokens as u64,
        completion_tokens as u64,
    )
}

#[tauri::command]
pub fn agent_request_approval(
    app: AppHandle,
    run_id: String,
    tool_call_id: String,
    arguments_json: String,
    display_summary: String,
    ttl_seconds: Option<i64>,
) -> Result<String, String> {
    let database = local_store::connection(&app)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let expires_at = ttl_seconds.map(|t| now + t);
    // Persist the tool call row if it doesn't exist yet so the FK resolves
    // when the approval row is created. Production tooling always inserts
    // the row first; we tolerate either order.
    let _ = database.execute(
        "INSERT OR IGNORE INTO agent_tool_calls(id, run_id, tool_name, risk_level, arguments_json, arguments_hash, status)
         VALUES(?1, ?2, 'pending', 'local_write', ?3, ?4, 'PENDING')",
        rusqlite::params![tool_call_id, run_id, arguments_json, hash_arguments(&arguments_json)],
    );
    request_approval(
        &database,
        &run_id,
        &tool_call_id,
        &arguments_json,
        &display_summary,
        expires_at,
    )
}

#[tauri::command]
pub fn agent_approve(
    app: AppHandle,
    approval_id: String,
    decision_source: Option<String>,
) -> Result<ApprovalDecision, String> {
    let database = local_store::connection(&app)?;
    approval_decide(
        &database,
        &approval_id,
        ApprovalStatus::Approved,
        decision_source.as_deref().unwrap_or("ui"),
    )
}

#[tauri::command]
pub fn agent_deny(
    app: AppHandle,
    approval_id: String,
    decision_source: Option<String>,
) -> Result<ApprovalDecision, String> {
    let database = local_store::connection(&app)?;
    approval_decide(
        &database,
        &approval_id,
        ApprovalStatus::Denied,
        decision_source.as_deref().unwrap_or("ui"),
    )
}

#[tauri::command]
pub fn agent_verify_approval(
    app: AppHandle,
    approval_id: String,
    arguments_json: String,
) -> Result<bool, String> {
    let database = local_store::connection(&app)?;
    let row = database
        .query_row(
            "SELECT a.id, a.run_id, a.tool_call_id, a.status, t.arguments_hash, a.approved_arguments_hash
             FROM agent_approvals a JOIN agent_tool_calls t ON t.id = a.tool_call_id
             WHERE a.id = ?1",
            rusqlite::params![approval_id],
            |row| {
                let status_str: String = row.get(3)?;
                let status = ApprovalStatus::parse(&status_str).unwrap_or(ApprovalStatus::Pending);
                Ok(ApprovalDecision {
                    id: row.get(0)?,
                    run_id: row.get(1)?,
                    tool_call_id: row.get(2)?,
                    status,
                    arguments_hash: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    approved_arguments_hash: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(decision) = row else {
        return Err(format!("approval {approval_id} not found"));
    };
    match verify(&arguments_json, &decision) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub fn agent_save_checkpoint(
    app: AppHandle,
    run_id: String,
    state: CheckpointState,
) -> Result<String, String> {
    let database = local_store::connection(&app)?;
    save_checkpoint(&database, &run_id, &state)
}

#[tauri::command]
pub fn agent_latest_checkpoint(
    app: AppHandle,
    run_id: String,
) -> Result<Option<CheckpointState>, String> {
    let database = local_store::connection(&app)?;
    latest_for_run(&database, &run_id)
}

#[tauri::command]
pub fn agent_mark_unknown_runs(app: AppHandle, run_id: String) -> Result<usize, String> {
    let database = local_store::connection(&app)?;
    mark_unknown_runners(&database, &run_id)
}

fn current_status(database: &Connection, run_id: &str) -> Result<Option<AgentStatus>, String> {
    let raw: Option<String> = database
        .query_row(
            "SELECT status FROM agent_runs WHERE id=?1",
            rusqlite::params![run_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(raw.and_then(|r| AgentStatus::parse(&r)))
}
