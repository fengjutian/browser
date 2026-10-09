//! Lightweight event bus — stores an [`AppHandle`] so background workers
//! (RAG supervisor, agent supervisor, privacy event writer) can publish
//! Tauri events without holding the AppHandle directly.
//!
//! The AppHandle is `Send + Sync`; we wrap it in an `OnceLock<Mutex<...>>`
//! so the supervisor can `set()` once at startup and `publish()` thereafter.
//! We store it as a type-erased `Box<dyn Any + Send + Sync>` so the
//! publisher can ignore the runtime parameter.

use std::any::Any;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

type Erased = Box<dyn Any + Send + Sync>;

static HANDLE: OnceLock<Mutex<Option<Erased>>> = OnceLock::new();

pub fn set_app_handle<R: Runtime>(handle: AppHandle<R>) {
    let slot = HANDLE.get_or_init(|| Mutex::new(None));
    if let Ok(mut g) = slot.lock() {
        *g = Some(Box::new(handle) as Erased);
    }
}

pub fn publish<T: Serialize + Clone>(event: &str, payload: &T) -> Result<(), String> {
    let Some(slot) = HANDLE.get() else {
        return Err("event bus not initialised".into());
    };
    let guard = slot.lock().map_err(|e| e.to_string())?;
    let Some(any) = guard.as_ref() else {
        return Err("event bus handle is None".into());
    };
    // We erased the runtime parameter at `set_app_handle`; here we
    // downcast back to `AppHandle<tauri::Wry>` (the only runtime we ship).
    // If a future runtime lands, this `downcast_ref` is the place to add
    // a parallel branch.
    let Some(handle) = any.downcast_ref::<AppHandle<tauri::Wry>>() else {
        return Err("event bus handle is not Wry".into());
    };
    handle
        .emit_to("main", event, payload.clone())
        .map_err(|e| e.to_string())
}

pub fn try_publish<T: Serialize + Clone>(event: &str, payload: &T) {
    let _ = publish(event, payload);
}
