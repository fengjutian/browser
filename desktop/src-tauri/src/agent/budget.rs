//! Run budgets (spec C11).
//!
//! Counters incremented at every relevant boundary:
//! - each model call advances `step_count` and adds token usage
//! - each tool call advances `tool_call_count`
//! - wall-clock vs `deadline_at`
//!
//! `evaluate` returns the first budget that has been exhausted, so callers
//! can pause the run with a precise reason instead of just "FAILED".

use std::time::SystemTime;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BudgetCounters {
    pub step_count: u32,
    pub tool_call_count: u32,
    pub model_call_count: u32,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cost_micros: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BudgetLimits {
    pub max_steps: u32,
    pub max_tool_calls: u32,
    pub max_model_calls: u32,
    pub max_prompt_tokens: u64,
    pub max_completion_tokens: u64,
    pub max_cost_micros: u64,
    pub deadline_unix_seconds: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum BudgetVerdict {
    Ok,
    Exhausted,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetExhausted {
    pub verdict: BudgetVerdict,
    pub reason: String,
}

pub fn evaluate(now_unix: i64, limits: &BudgetLimits, current: &BudgetCounters) -> BudgetExhausted {
    if limits.max_steps > 0 && current.step_count > limits.max_steps {
        return BudgetExhausted {
            verdict: BudgetVerdict::Exhausted,
            reason: "max_steps".into(),
        };
    }
    if limits.max_tool_calls > 0 && current.tool_call_count > limits.max_tool_calls {
        return BudgetExhausted {
            verdict: BudgetVerdict::Exhausted,
            reason: "max_tool_calls".into(),
        };
    }
    if limits.max_model_calls > 0 && current.model_call_count > limits.max_model_calls {
        return BudgetExhausted {
            verdict: BudgetVerdict::Exhausted,
            reason: "max_model_calls".into(),
        };
    }
    if limits.max_prompt_tokens > 0 && current.prompt_tokens > limits.max_prompt_tokens {
        return BudgetExhausted {
            verdict: BudgetVerdict::Exhausted,
            reason: "max_prompt_tokens".into(),
        };
    }
    if limits.max_completion_tokens > 0 && current.completion_tokens > limits.max_completion_tokens
    {
        return BudgetExhausted {
            verdict: BudgetVerdict::Exhausted,
            reason: "max_completion_tokens".into(),
        };
    }
    if limits.max_cost_micros > 0 && current.cost_micros > limits.max_cost_micros {
        return BudgetExhausted {
            verdict: BudgetVerdict::Exhausted,
            reason: "max_cost_micros".into(),
        };
    }
    if let Some(deadline) = limits.deadline_unix_seconds {
        if deadline > 0 && now_unix > deadline {
            return BudgetExhausted {
                verdict: BudgetVerdict::Exhausted,
                reason: "deadline_at".into(),
            };
        }
    }
    BudgetExhausted {
        verdict: BudgetVerdict::Ok,
        reason: String::new(),
    }
}

pub fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_budgets_pass_through() {
        let v = evaluate(
            now_unix(),
            &BudgetLimits::default(),
            &BudgetCounters::default(),
        );
        assert_eq!(v.verdict, BudgetVerdict::Ok);
    }

    #[test]
    fn max_steps_exhausts_first() {
        let limits = BudgetLimits {
            max_steps: 1,
            ..Default::default()
        };
        let current = BudgetCounters {
            step_count: 2,
            ..Default::default()
        };
        let v = evaluate(now_unix(), &limits, &current);
        assert_eq!(v.verdict, BudgetVerdict::Exhausted);
        assert_eq!(v.reason, "max_steps");
    }

    #[test]
    fn deadline_overrun_is_reported() {
        let limits = BudgetLimits {
            deadline_unix_seconds: Some(now_unix() - 1),
            ..Default::default()
        };
        let v = evaluate(now_unix(), &limits, &BudgetCounters::default());
        assert_eq!(v.reason, "deadline_at");
    }

    #[test]
    fn tok_aware_cost_limit_is_enforced() {
        let limits = BudgetLimits {
            max_cost_micros: 100,
            ..Default::default()
        };
        let current = BudgetCounters {
            cost_micros: 101,
            ..Default::default()
        };
        let v = evaluate(now_unix(), &limits, &current);
        assert_eq!(v.reason, "max_cost_micros");
    }
}
