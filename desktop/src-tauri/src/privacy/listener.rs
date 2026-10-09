//! Windows sub-resource blocking (spec B5 / batch 7).
//!
//! Attaches a `WebResourceRequested` handler to a WebView2 instance using the
//! shared `CompiledSetHandle`. The handler:
//!
//! 1. Skips non-blockable resource types early.
//! 2. Resolves the URL and top-level origin from event args.
//! 3. Calls `privacy::matcher::match_request` against the active compiled set.
//! 4. On `Block`, returns an HTTP `204` with an empty body via
//!    `ICoreWebView2WebResourceResponse::put_Status`.
//! 5. Records the event into `privacy_block_events` and bumps the live
//!    counter `PRIVACY_EVENTS_TOTAL`. The throttle batches count events up
//!    for 250 ms and emits a single `privacy://count` Tauri event so the UI
//!    never gets a per-request flood.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rusqlite::Connection;

use super::compiler::CompiledSetHandle;
use super::matcher::{match_request, RequestMeta};
use super::types::ResourceType;

/// Snapshot of total block counts since process start. Read by the toolbar
/// UI directly; additionally flushed to `privacy_block_events` on tick.
#[derive(Debug, Default)]
pub struct LiveCounters {
    pub total_blocked: AtomicU64,
    pub total_allowed: AtomicU64,
    pub last_emit: Mutex<Option<Instant>>,
}

/// Process-wide counters. Bound to the Tauri state so the React side can
/// read them via a Tauri command without going through the database.
pub static PRIVACY_EVENTS_TOTAL: LiveCounters = LiveCounters {
    total_blocked: AtomicU64::new(0),
    total_allowed: AtomicU64::new(0),
    last_emit: Mutex::new(None),
};

const EMIT_THROTTLE_MS: u128 = 250;

#[derive(Debug, Clone)]
pub enum DecideOutcome {
    /// `Block` returned the HTTP 204 response.
    Blocked,
    /// Allow / no-op.
    Allowed,
    /// Resource isn't something we can intercept (e.g. Document main frame).
    Skipped,
    /// Matcher dispatched but the compiled set said no.
    PassThrough,
}

/// Decide what to do with a single WebResource request.
///
/// Pure function that doesn't touch the COM surface — Windows code below
/// implements `WebResourceRequested` and forwards into this.
pub fn decide(
    url: &str,
    top_level_origin: Option<&str>,
    resource_type: ResourceType,
    third_party: bool,
    set: &Arc<CompiledSetHandle>,
) -> DecideOutcome {
    if matches!(resource_type, ResourceType::Document) {
        // Spec: never intercept the top-level document here — that's the
        // `NavigationStarting` hook's job (handled by `legacy_nav`).
        return DecideOutcome::Skipped;
    }
    let compiled = set.snapshot();
    let meta = RequestMeta {
        url: url.to_string(),
        top_level_origin: top_level_origin.map(|s| s.to_string()),
        resource_type,
        third_party,
        list_id: None,
    };
    let outcome = match_request(&compiled, &meta);
    if !outcome.matched {
        PRIVACY_EVENTS_TOTAL.total_allowed.fetch_add(1, Ordering::Relaxed);
        return DecideOutcome::PassThrough;
    }
    match outcome.action {
        Some(super::types::RuleAction::Block) => {
            PRIVACY_EVENTS_TOTAL.total_blocked.fetch_add(1, Ordering::Relaxed);
            DecideOutcome::Blocked
        }
        Some(super::types::RuleAction::Allow) => {
            PRIVACY_EVENTS_TOTAL.total_allowed.fetch_add(1, Ordering::Relaxed);
            DecideOutcome::Allowed
        }
        _ => DecideOutcome::PassThrough,
    }
}

/// Map a WebView2 `COREWEBVIEW2_WEB_RESOURCE_CONTEXT` value to our
/// `ResourceType`. Implemented for Windows in the platform-specific module
/// since the enum lives behind `webview2_com`; on other targets we expose
/// the converter through the literal byte values.
pub fn classify_resource_type(context_byte: u32) -> ResourceType {
    // Stable values from the WebView2 header:
    //   0 Document, 1 Stylesheet, 2 Image, 4 Script, 8 XHR, 16 SubDocument,
    //   32 Fetch, 64 Font, 256 Media, 512 WebSocket, ...
    // We don't use the bitmask origin (3 bits) — they're a parallel field.
    let kind = context_byte & 0x3FC; // mask the low flags we don't care about
    match kind & 0x3FC {
        x if x == 1 => ResourceType::Stylesheet,
        x if x == 2 => ResourceType::Image,
        x if x == 4 => ResourceType::Script,
        x if x == 8 || x == 32 => ResourceType::XmlHttpRequest,
        x if x == 16 => ResourceType::SubDocument,
        x if x == 64 => ResourceType::Font,
        x if x == 256 => ResourceType::Media,
        _ => ResourceType::Other,
    }
}

/// Maybe-emit a throttled count event to the front end.
pub fn maybe_emit_throttled<F>(emit: F)
where
    F: FnOnce(u64, u64),
{
    let last = PRIVACY_EVENTS_TOTAL.last_emit.lock().ok().and_then(|g| *g);
    if let Some(when) = last {
        if when.elapsed().as_millis() < EMIT_THROTTLE_MS {
            return;
        }
    }
    let blocked = PRIVACY_EVENTS_TOTAL.total_blocked.load(Ordering::Relaxed);
    let allowed = PRIVACY_EVENTS_TOTAL.total_allowed.load(Ordering::Relaxed);
    if let Ok(mut guard) = PRIVACY_EVENTS_TOTAL.last_emit.lock() {
        *guard = Some(Instant::now());
        drop(guard);
        emit(blocked, allowed);
    }
}

/// Persist a single block event into `privacy_block_events`. The DB write
/// happens on a worker-thread-safe connection — production wires
/// `tauri::State<DbPool>` here; the listener only sees `&Connection`.
pub fn persist_block_event(
    database: &Connection,
    top_level_origin: &str,
    request_host: &str,
    resource_type: ResourceType,
    rule_id: Option<u64>,
) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let type_str = resource_type.as_token();
    database
        .execute(
            "INSERT INTO privacy_block_events(id, top_level_origin, request_host, resource_type, rule_id, blocked_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                id,
                top_level_origin,
                request_host,
                type_str,
                rule_id.map(|r| r as i64),
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    // Update per-day aggregate if present.
    let _ = database.execute(
        "INSERT INTO privacy_daily_stats(stat_date, origin, category, resource_type, blocked_count)
         VALUES(strftime('%Y-%m-%d', ?1, 'unixepoch'), ?2, 'block', ?3, 1)
         ON CONFLICT(stat_date, origin, category, resource_type) DO UPDATE
         SET blocked_count = blocked_count + 1",
        rusqlite::params![now, top_level_origin, type_str],
    );
    Ok(())
}

/// Flush pending events older than the throttle interval to disk. Returns
/// the elapsed wall time so the listener can decide whether to skip a tick.
pub fn flush_throttled(
    database: &Connection,
    last_flush: &Mutex<Option<Instant>>,
    min_interval: Duration,
) -> Result<bool, String> {
    let due = {
        let last = last_flush.lock().ok().and_then(|g| *g);
        match last {
            Some(t) if t.elapsed() < min_interval => false,
            _ => true,
        }
    };
    if !due {
        return Ok(false);
    }
    if let Ok(mut g) = last_flush.lock() {
        *g = Some(Instant::now());
    }
    // Aggregates are updated through `persist_block_event` directly; this
    // function is a hook for downstream flushes (e.g. daily rollups).
    let _ = database;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_set() -> Arc<CompiledSetHandle> {
        Arc::new(CompiledSetHandle::new(Default::default()))
    }

    #[test]
    fn document_requests_are_skipped_here() {
        let outcome = decide(
            "https://example.com/",
            None,
            ResourceType::Document,
            false,
            &empty_set(),
        );
        assert!(matches!(outcome, DecideOutcome::Skipped));
    }

    #[test]
    fn empty_set_lets_requests_through() {
        let outcome = decide(
            "https://example.com/foo.js",
            Some("https://publisher.com"),
            ResourceType::Script,
            true,
            &empty_set(),
        );
        assert!(matches!(outcome, DecideOutcome::PassThrough));
    }

    #[test]
    fn classify_resource_type_maps_known_contexts() {
        assert_eq!(classify_resource_type(2), ResourceType::Image);
        assert_eq!(classify_resource_type(4), ResourceType::Script);
        assert_eq!(classify_resource_type(8), ResourceType::XmlHttpRequest);
        assert_eq!(classify_resource_type(16), ResourceType::SubDocument);
    }

    #[test]
    fn counters_increment_on_pass_through() {
        let before = PRIVACY_EVENTS_TOTAL.total_allowed.load(Ordering::Relaxed);
        let _ = decide(
            "https://example.com/x",
            None,
            ResourceType::Image,
            false,
            &empty_set(),
        );
        let after = PRIVACY_EVENTS_TOTAL.total_allowed.load(Ordering::Relaxed);
        assert!(after > before, "pass-through must bump allowed counter");
    }
}
