//! Lightweight event bus — stores an [`AppHandle`] so background workers
//! (RAG supervisor, agent supervisor, privacy event writer) can publish
//! Tauri events without holding the AppHandle directly.
//!
//! The AppHandle is `Send + Sync`; we wrap it in an `OnceLock<Mutex<...>>`
//! so the supervisor can `set()` once at startup and `publish()` thereafter.

use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

static HANDLE: OnceLock<Mutex<Option<AppHandle<tauri::Wry>>>> = OnceLock::new();

pub fn set_wry_handle(handle: AppHandle<tauri::Wry>) {
    let slot = HANDLE.get_or_init(|| Mutex::new(None));
    if let Ok(mut g) = slot.lock() {
        *g = Some(handle);
    }
}

pub fn publish<T: Serialize + Clone>(event: &str, payload: &T) -> Result<(), String> {
    let Some(slot) = HANDLE.get() else {
        return Err("event bus not initialised".into());
    };
    let guard = slot.lock().map_err(|e| e.to_string())?;
    let Some(handle) = guard.as_ref() else {
        return Err("event bus handle is None".into());
    };
    handle
        .emit_to("main", event, payload.clone())
        .map_err(|e| e.to_string())
}

pub fn try_publish<T: Serialize + Clone>(event: &str, payload: &T) {
    let _ = publish(event, payload);
}