//! Persistent approval engine (spec C7).
//!
//! Approvals are bound to the `arguments_hash` of the tool call: if the
//! tool call arguments change between approval and execution, the approval
//! is invalid. This catches a class of model-driven tampering where the
//! LLM rewrites the JSON to bypass user review.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::types::ApprovalStatus;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalDecision {
    pub id: String,
    pub run_id: String,
    pub tool_call_id: String,
    pub status: ApprovalStatus,
    pub arguments_hash: String,
    pub approved_arguments_hash: Option<String>,
}

pub fn hash_arguments(arguments_json: &str) -> String {
    format!("{:x}", Sha256::digest(arguments_json.as_bytes()))
}

pub fn request_approval(
    database: &Connection,
    run_id: &str,
    tool_call_id: &str,
    arguments_json: &str,
    display_summary: &str,
    expires_at: Option<i64>,
) -> Result<String, String> {
    let args_hash = hash_arguments(arguments_json);
    let id = uuid::Uuid::new_v4().to_string();
    let requested_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    database
        .execute(
            "INSERT INTO agent_approvals(id, run_id, tool_call_id, status, requested_at, expires_at, display_summary, approved_arguments_hash)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)",
            params![
                id,
                run_id,
                tool_call_id,
                ApprovalStatus::Pending.as_str(),
                requested_at,
                expires_at,
                display_summary,
            ],
        )
        .map_err(|e| e.to_string())?;
    // Store args hash on the tool call so we can compare later.
    let _ = database.execute(
        "UPDATE agent_tool_calls SET arguments_hash=?1, requires_approval=1 WHERE id=?2",
        params![args_hash, tool_call_id],
    );
    Ok(id)
}

pub fn decide(
    database: &Connection,
    approval_id: &str,
    decision: ApprovalStatus,
    decision_source: &str,
) -> Result<ApprovalDecision, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let approved_hash = if matches!(decision, ApprovalStatus::Approved) {
        let row = database
            .query_row(
                "SELECT a.arguments_hash FROM agent_tool_calls tc
                 JOIN agent_approvals a ON a.tool_call_id = tc.id WHERE a.id = ?1",
                params![approval_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        Some(row)
    } else {
        None
    };
    database
        .execute(
            "UPDATE agent_approvals SET status=?1, decided_at=?2, decision_source=?3, approved_arguments_hash=?4
             WHERE id=?5",
            params![
                decision.as_str(),
                now,
                decision_source,
                approved_hash.as_deref(),
                approval_id,
            ],
        )
        .map_err(|e| e.to_string())?;
    let row = database
        .query_row(
            "SELECT a.id, a.run_id, a.tool_call_id, a.status, a.approved_arguments_hash, t.arguments_hash
             FROM agent_approvals a JOIN agent_tool_calls t ON t.id = a.tool_call_id
             WHERE a.id = ?1",
            params![approval_id],
            |row| {
                let status_str: String = row.get(3)?;
                let status = ApprovalStatus::parse(&status_str).unwrap_or(ApprovalStatus::Pending);
                Ok(ApprovalDecision {
                    id: row.get(0)?,
                    run_id: row.get(1)?,
                    tool_call_id: row.get(2)?,
                    status,
                    arguments_hash: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    approved_arguments_hash: row.get(4)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(row)
}

/// Verify that the current call's arguments still match what the user
/// approved. Returns `Ok(())` when:
/// - there's no approval on record (auto-allowed);
/// - the approval's hash matches the live arguments.
/// Returns `Err` when the model rewrote the arguments after approval.
pub fn verify(arguments_json: &str, decision: &ApprovalDecision) -> Result<(), String> {
    let approved = decision
        .approved_arguments_hash
        .as_deref()
        .unwrap_or(&decision.arguments_hash);
    let live = hash_arguments(arguments_json);
    if approved == live {
        Ok(())
    } else {
        Err(format!(
            "approval stale: approved for hash {} but call uses {}",
            &approved[..8.min(approved.len())],
            &live[..8.min(live.len())]
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_stable_across_runs() {
        assert_eq!(hash_arguments("{}"), hash_arguments("{}"));
        assert_ne!(hash_arguments("{\"a\":1}"), hash_arguments("{\"a\":2}"));
    }

    #[test]
    fn verify_matching_args_pass() {
        let decision = ApprovalDecision {
            id: "a".into(),
            run_id: "r".into(),
            tool_call_id: "t".into(),
            status: ApprovalStatus::Approved,
            arguments_hash: hash_arguments("{\"a\":1}"),
            approved_arguments_hash: Some(hash_arguments("{\"a\":1}")),
        };
        assert!(verify("{\"a\":1}", &decision).is_ok());
    }

    #[test]
    fn verify_modified_args_is_rejected() {
        let decision = ApprovalDecision {
            id: "a".into(),
            run_id: "r".into(),
            tool_call_id: "t".into(),
            status: ApprovalStatus::Approved,
            arguments_hash: hash_arguments("{\"a\":1}"),
            approved_arguments_hash: Some(hash_arguments("{\"a\":1}")),
        };
        assert!(verify("{\"a\":2}", &decision).is_err());
    }
}
