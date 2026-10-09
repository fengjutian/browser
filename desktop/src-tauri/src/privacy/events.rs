//! Privacy event worker (batch 11 spec — privacy section).
//!
//! The Windows `WebResourceRequested` callback runs on the WebView2 request
//! thread; we cannot synchronously call SQLite there without blocking the
//! browser. Instead the handler does `try_send(PrivacyBlockEvent)` into a
//! bounded `tokio::sync::mpsc` and a background worker drains the channel
//! in batches and persists them transactionally. When the channel is full
//! (we're backed up faster than we can write) we increment a `dropped`
//! counter instead of blocking the request thread.

use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use super::types::ResourceType;

pub const CHANNEL_CAPACITY: usize = 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyBlockEvent {
    pub tab_label: String,
    pub top_level_origin: String,
    pub request_host: String,
    pub resource_type: ResourceType,
    pub rule_id: Option<u64>,
    pub category: Option<String>,
    pub private: bool,
    pub blocked_at: i64,
}

#[derive(Debug, Default)]
pub struct PrivacyEventStats {
    pub total_blocked: AtomicU64,
    pub total_allowed: AtomicU64,
    pub total_dropped: AtomicU64,
    pub last_emit_ms: std::sync::Mutex<Option<u128>>,
}

impl PrivacyEventStats {
    pub fn snapshot(&self) -> (u64, u64, u64) {
        (
            self.total_blocked.load(Ordering::Relaxed),
            self.total_allowed.load(Ordering::Relaxed),
            self.total_dropped.load(Ordering::Relaxed),
        )
    }
}

/// Sender half held in `PrivacyRuntimeState`. Cloned into WebView2 handlers
/// so each tab can send events independently.
#[derive(Clone)]
pub struct PrivacyEventSender {
    inner: mpsc::Sender<PrivacyBlockEvent>,
    stats: std::sync::Arc<PrivacyEventStats>,
}

impl PrivacyEventSender {
    /// Non-blocking send. Drops the event and bumps the dropped counter if
    /// the channel is full. Never blocks the WebView2 request thread.
    pub fn try_send(&self, event: PrivacyBlockEvent) {
        match self.inner.try_send(event) {
            Ok(()) => {}
            Err(_) => {
                self.stats.total_dropped.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    pub fn record_block(&self) {
        self.stats.total_blocked.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_allow(&self) {
        self.stats.total_allowed.fetch_add(1, Ordering::Relaxed);
    }

    pub fn stats(&self) -> std::sync::Arc<PrivacyEventStats> {
        self.stats.clone()
    }
}

/// Build a fresh `(sender, worker)` pair. Caller is responsible for
/// spawning `worker` on the runtime.
pub fn build_pair() -> (PrivacyEventSender, Worker) {
    let (tx, rx) = mpsc::channel::<PrivacyBlockEvent>(CHANNEL_CAPACITY);
    let stats = std::sync::Arc::new(PrivacyEventStats::default());
    let sender = PrivacyEventSender {
        inner: tx,
        stats: stats.clone(),
    };
    let worker = Worker {
        receiver: rx,
        stats,
    };
    (sender, worker)
}

pub struct Worker {
    receiver: mpsc::Receiver<PrivacyBlockEvent>,
    stats: std::sync::Arc<PrivacyEventStats>,
}

impl Worker {
    /// Drain the receiver in batches and persist them. Returns when the
    /// receiver is closed or the cancel token fires.
    pub async fn run(
        mut self,
        database: std::sync::Arc<tokio::sync::Mutex<Connection>>,
        cancel: tokio_util::sync::CancellationToken,
    ) {
        const BATCH_SIZE: usize = 32;
        const FLUSH_INTERVAL_MS: u128 = 250;
        let mut batch: Vec<PrivacyBlockEvent> = Vec::with_capacity(BATCH_SIZE);
        loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => {
                    if !batch.is_empty() {
                        let conn = database.lock().await;
                        flush_batch_sync(&conn, &batch);
                    }
                    break;
                }
                next = self.receiver.recv() => {
                    match next {
                        Some(event) => {
                            batch.push(event);
                            if batch.len() >= BATCH_SIZE {
                                let conn = database.lock().await;
                                flush_batch_sync(&conn, &batch);
                                drop(conn);
                                batch.clear();
                            }
                        }
                        None => {
                            if !batch.is_empty() {
                                let conn = database.lock().await;
                                flush_batch_sync(&conn, &batch);
                            }
                            break;
                        }
                    }
                }
                _ = tokio::time::sleep(std::time::Duration::from_millis(FLUSH_INTERVAL_MS as u64)) => {
                    if !batch.is_empty() {
                        let conn = database.lock().await;
                        flush_batch_sync(&conn, &batch);
                        drop(conn);
                        batch.clear();
                    }
                }
            }
            let snapshot = self.stats.snapshot();
            // Throttle UI emits to 250 ms.
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            let should_emit = {
                let last = self.stats.last_emit_ms.lock().ok().and_then(|g| *g);
                match last {
                    Some(t) if now_ms.saturating_sub(t) < FLUSH_INTERVAL_MS => false,
                    _ => true,
                }
            };
            if should_emit {
                if let Ok(mut g) = self.stats.last_emit_ms.lock() {
                    *g = Some(now_ms);
                }
                crate::event_bus::try_publish(
                    "privacy://count",
                    &serde_json::json!({
                        "blocked": snapshot.0,
                        "allowed": snapshot.1,
                        "dropped": snapshot.2,
                    }),
                );
            }
        }
    }
}

/// Synchronous batch insert. We deliberately do not call any Tauri APIs here
/// — a single transaction wraps all inserts so the database sees a clean
/// cut. Private events are never written: the worker drops them before
/// they reach the DB.
fn flush_batch_sync(database: &Connection, batch: &[PrivacyBlockEvent]) {
    if batch.is_empty() {
        return;
    }
    let transaction = match database.unchecked_transaction() {
        Ok(t) => t,
        Err(_) => return,
    };
    let mut counts: std::collections::HashMap<(String, String, String), i64> =
        std::collections::HashMap::new();
    for event in batch {
        if event.private {
            continue;
        }
        let id = uuid::Uuid::new_v4().to_string();
        let type_str = event.resource_type.as_token();
        let outcome = transaction.execute(
            "INSERT INTO privacy_block_events(id, top_level_origin, request_host, resource_type, rule_id, blocked_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                id,
                event.top_level_origin,
                event.request_host,
                type_str,
                event.rule_id.map(|r| r as i64),
                event.blocked_at,
            ],
        );
        if outcome.is_err() {
            return;
        }
        *counts
            .entry((
                event.top_level_origin.clone(),
                "block".to_string(),
                type_str.to_string(),
            ))
            .or_insert(0) += 1;
    }
    let _ = transaction.commit();
    // Upsert daily stats outside the transaction so a slow rollup can't
    // block event persistence.
    let transaction = match database.unchecked_transaction() {
        Ok(t) => t,
        Err(_) => return,
    };
    for ((origin, category, type_str), delta) in counts {
        let _ = transaction.execute(
            "INSERT INTO privacy_daily_stats(stat_date, origin, category, resource_type, blocked_count)
             VALUES(strftime('%Y-%m-%d', 'now'), ?1, ?2, ?3, ?4)
             ON CONFLICT(stat_date, origin, category, resource_type) DO UPDATE
             SET blocked_count = blocked_count + ?4",
            rusqlite::params![origin, category, type_str, delta],
        );
    }
    let _ = transaction.commit();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn sender_records_stats_when_channel_drops() {
        let (sender, worker) = build_pair();
        // Drain the worker immediately by closing the receiver.
        drop(worker);
        // Send should still bump dropped counter after the channel is closed.
        sender.try_send(PrivacyBlockEvent {
            tab_label: "t".into(),
            top_level_origin: "https://e.com".into(),
            request_host: "e.com".into(),
            resource_type: ResourceType::Script,
            rule_id: None,
            category: Some("ads".into()),
            private: false,
            blocked_at: 0,
        });
        let (blocked, _allowed, dropped) = sender.stats().snapshot();
        assert_eq!(blocked, 0);
        assert!(dropped >= 1);
    }
}
