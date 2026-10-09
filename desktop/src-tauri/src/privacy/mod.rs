//! Privacy layer.
//!
//! Submodules in this directory cover the spec B-epic surface:
//! - `legacy_nav` — the existing WebView2 top-level `NavigationStarting` interceptor.
//! - `types`     — rule model (B1).
//! - `parser`    — ABP-subset parser (B1).
//! - `compiler`  — compiled matcher state (B4).
//! - `matcher`   — request-time decision (B4 + B5).
//!
//! Batch 6 is the first batch to populate the ABP-style path; sub-resource
//! blocking lands in batch 7 (Windows `WebResourceRequested`).

mod legacy_nav;
pub mod commands;
pub mod compiler;
pub mod listener;
pub mod matcher;
pub mod parser;
pub mod platform;
pub mod types;

pub use legacy_nav::{
    attach_navigation_guard, baseline_blocked_hosts, is_blocked_host, NavBlockRegistry,
    NavBlockedEvent, NAV_BLOCKED_EVENT,
};
pub use types::{ResourceType, RuleAction};
