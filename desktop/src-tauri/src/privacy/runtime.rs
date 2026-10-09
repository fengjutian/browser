//! Privacy runtime state (batch 11 — spec B5).
//!
//! One global `PrivacyRuntimeState` is held in Tauri `manage(...)` so every
//! caller (WebView2 attach handler, Tauri command, settings page) can
//! reach the live compiled snapshot, the bounded event sender, and the
//! per-tab capability registry without juggling globals.

use std::sync::Arc;

use tokio_util::sync::CancellationToken;

use super::compiler::{CompiledRuleSet, CompiledSetHandle};
use super::events::{build_pair, PrivacyEventSender};

/// Snapshot of platform capabilities, recorded per WebView when attach runs.
#[derive(Debug, Default, Clone)]
pub struct CapabilityRecord {
    pub label: String,
    pub network_subresource_blocking: bool,
    pub cosmetic_filtering: bool,
    pub notes: Vec<String>,
}

#[derive(Debug, Default)]
pub struct PrivacyCapabilityRegistry {
    inner: std::sync::Mutex<Vec<CapabilityRecord>>,
}

impl PrivacyCapabilityRegistry {
    pub fn record(&self, record: CapabilityRecord) {
        if let Ok(mut g) = self.inner.lock() {
            g.retain(|r| r.label != record.label);
            g.push(record);
        }
    }

    pub fn remove(&self, label: &str) {
        if let Ok(mut g) = self.inner.lock() {
            g.retain(|r| r.label != label);
        }
    }

    pub fn snapshot(&self) -> Vec<CapabilityRecord> {
        self.inner
            .lock()
            .ok()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub fn network_subresource_blocking_any(&self) -> bool {
        self.inner
            .lock()
            .ok()
            .map(|g| g.iter().any(|r| r.network_subresource_blocking))
            .unwrap_or(false)
    }
}

/// State stored in Tauri `manage(...)`. The compiled set is held in an
/// `Arc<CompiledSetHandle>` so background tasks (RAG retrieval,
/// `WebResourceRequested` handler) can read it lock-free.
pub struct PrivacyRuntimeState {
    pub compiled: Arc<CompiledSetHandle>,
    pub capabilities: Arc<PrivacyCapabilityRegistry>,
    pub events: PrivacyEventSender,
    pub update_cancel: CancellationToken,
    /// Worker owned by the runtime state. `take_worker()` in `setup`
    /// pulls it out so the same channel backing `self.events` drains
    /// inside the worker task.
    pub worker_slot: std::sync::Mutex<Option<super::events::Worker>>,
}

impl Default for PrivacyRuntimeState {
    fn default() -> Self {
        Self::new()
    }
}

impl PrivacyRuntimeState {
    pub fn new() -> Self {
        let (events, worker) = build_pair();
        Self {
            compiled: Arc::new(CompiledSetHandle::new(CompiledRuleSet::default())),
            capabilities: Arc::new(PrivacyCapabilityRegistry::default()),
            events,
            update_cancel: CancellationToken::new(),
            worker_slot: std::sync::Mutex::new(Some(worker)),
        }
    }

    /// Take the privacy event worker out of the runtime state. The caller
    /// is responsible for spawning it on a tokio runtime. This pattern
    /// guarantees the worker drains from the same channel that
    /// `self.events` writes into.
    pub fn take_worker(&self) -> Option<super::events::Worker> {
        self.worker_slot.lock().ok().and_then(|mut g| g.take())
    }
}
