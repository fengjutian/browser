use super::{PluginContext, PluginManifest, PluginPermission, PluginRuntime, WasmRuntime};
use rusqlite::params;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::Manager;

const MAX_ARCHIVE: u64 = 20 * 1024 * 1024;
const MAX_EXPANDED: u64 = 50 * 1024 * 1024;
const MAX_FILES: usize = 256;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub status: String,
    pub enabled: bool,
    pub last_error: Option<String>,
    pub manifest: PluginManifest,
    pub grants: Vec<PluginPermission>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAuditEntry {
    pub id: String,
    pub plugin_id: String,
    pub action: String,
    pub permission: Option<String>,
    pub success: bool,
    pub error: Option<String>,
    pub created_at: i64,
}

fn audit(
    db: &rusqlite::Connection,
    plugin_id: &str,
    action: &str,
    permission: Option<&str>,
    result: &Result<(), String>,
) {
    let _=db.execute("INSERT INTO plugin_audit_log(id,plugin_id,action,permission,success,error,created_at) VALUES(?,?,?,?,?,?,?)",params![uuid::Uuid::new_v4().to_string(),plugin_id,action,permission,result.is_ok() as i64,result.as_ref().err().map(|e|e.chars().take(500).collect::<String>()),chrono::Utc::now().timestamp()]);
}

fn plugin_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

#[tauri::command]
pub fn install_plugin(
    app: tauri::AppHandle,
    archive_path: String,
) -> Result<InstalledPlugin, String> {
    let source = Path::new(&archive_path);
    let meta = fs::metadata(source).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > MAX_ARCHIVE {
        return Err("plugin archive exceeds 20 MiB or is not a file".into());
    }
    let file = fs::File::open(source).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    if archive.len() > MAX_FILES {
        return Err("plugin archive contains too many files".into());
    }
    let mut manifest_bytes = Vec::new();
    archive
        .by_name("plugin.json")
        .map_err(|_| "plugin.json is missing")?
        .take(1024 * 1024)
        .read_to_end(&mut manifest_bytes)
        .map_err(|e| e.to_string())?;
    let manifest: PluginManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| format!("invalid plugin manifest: {e}"))?;
    manifest.validate().map_err(str::to_string)?;
    let root = plugin_root(&app)?;
    let staging = root.join(format!(".staging-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        let mut expanded = 0u64;
        for index in 0..archive.len() {
            let mut item = archive.by_index(index).map_err(|e| e.to_string())?;
            if item.is_dir() {
                continue;
            }
            let enclosed = item
                .enclosed_name()
                .ok_or("unsafe path in plugin archive")?
                .to_path_buf();
            expanded = expanded.saturating_add(item.size());
            if expanded > MAX_EXPANDED {
                return Err("expanded plugin exceeds 50 MiB".into());
            }
            let target = staging.join(enclosed);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?
            }
            let mut out = fs::File::create(target).map_err(|e| e.to_string())?;
            std::io::copy(&mut item, &mut out).map_err(|e| e.to_string())?;
            out.flush().map_err(|e| e.to_string())?
        }
        let component =
            fs::read(staging.join("plugin.wasm")).map_err(|_| "plugin.wasm is missing")?;
        let digest = format!("{:x}", Sha256::digest(&component));
        if !digest.eq_ignore_ascii_case(&manifest.sha256) {
            return Err("plugin.wasm sha256 mismatch".into());
        }
        let mut config = wasmtime::Config::new();
        config
            .wasm_component_model(true)
            .consume_fuel(true)
            .epoch_interruption(true);
        let engine = wasmtime::Engine::new(&config).map_err(|e| e.to_string())?;
        wasmtime::component::Component::from_binary(&engine, &component)
            .map_err(|e| format!("invalid WebAssembly component: {e}"))?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let target = root.join(&manifest.id).join(&manifest.version);
    fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
    if target.exists() {
        let _ = fs::remove_dir_all(&staging);
        return Err("plugin version is already installed".into());
    }
    fs::rename(&staging, &target).map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp();
    let json = serde_json::to_string(&manifest).map_err(|e| e.to_string())?;
    let db = crate::local_store::connection(&app)?;
    db.execute("INSERT INTO plugins(id,name,version,manifest_json,component_path,sha256,status,enabled,installed_at,updated_at) VALUES(?,?,?,?,?,?,'DISABLED',0,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=excluded.version,manifest_json=excluded.manifest_json,component_path=excluded.component_path,sha256=excluded.sha256,status='DISABLED',enabled=0,last_error=NULL,updated_at=excluded.updated_at",params![manifest.id,manifest.name,manifest.version,json,target.join("plugin.wasm").to_string_lossy(),manifest.sha256,now,now]).map_err(|e|e.to_string())?;
    let installed = read_plugin(&db, &manifest.id)?;
    audit(&db, &manifest.id, "install", None, &Ok(()));
    Ok(installed)
}

fn read_plugin(db: &rusqlite::Connection, id: &str) -> Result<InstalledPlugin, String> {
    let mut value=db.query_row("SELECT id,name,version,status,enabled,last_error,manifest_json FROM plugins WHERE id=?",[id],|r|{let raw:String=r.get(6)?;let manifest=serde_json::from_str(&raw).map_err(|e|rusqlite::Error::FromSqlConversionFailure(6,rusqlite::types::Type::Text,Box::new(e)))?;Ok(InstalledPlugin{id:r.get(0)?,name:r.get(1)?,version:r.get(2)?,status:r.get(3)?,enabled:r.get::<_,i64>(4)?!=0,last_error:r.get(5)?,manifest,grants:vec![]})}).map_err(|e|e.to_string())?;
    let mut stmt = db
        .prepare("SELECT permission FROM plugin_grants WHERE plugin_id=? AND granted=1")
        .map_err(|e| e.to_string())?;
    value.grants = stmt
        .query_map([id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter_map(|name| serde_json::from_str(&format!("\"{name}\"")).ok())
        .collect();
    Ok(value)
}

#[tauri::command]
pub fn list_plugins(app: tauri::AppHandle) -> Result<Vec<InstalledPlugin>, String> {
    let db = crate::local_store::connection(&app)?;
    let mut stmt = db
        .prepare("SELECT id FROM plugins ORDER BY name")
        .map_err(|e| e.to_string())?;
    let ids = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    ids.iter().map(|id| read_plugin(&db, id)).collect()
}

pub(crate) fn restore_enabled_plugins(app: &tauri::AppHandle) {
    let runtime = app.state::<WasmRuntime>();
    runtime.attach_app(app.clone());
    let Ok(db) = crate::local_store::connection(app) else {
        return;
    };
    let Ok(mut stmt) = db.prepare(
        "SELECT id,manifest_json,component_path FROM plugins WHERE enabled=1 AND status='ENABLED'",
    ) else {
        return;
    };
    let Ok(rows) = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    }) else {
        return;
    };
    let plugins = rows.filter_map(Result::ok).collect::<Vec<_>>();
    drop(stmt);
    for (id, raw, path) in plugins {
        let result = (|| {
            let manifest: PluginManifest = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            let current = read_plugin(&db, &id)?;
            runtime.start(
                &manifest,
                Path::new(&path),
                PluginContext::new(&id, current.grants),
            )
        })();
        if let Err(error) = &result {
            let _ = db.execute(
                "UPDATE plugins SET enabled=0,status='FAILED',last_error=?,updated_at=? WHERE id=?",
                params![error, chrono::Utc::now().timestamp(), id],
            );
        }
        audit(&db, &id, "restore", None, &result);
    }
}
#[tauri::command]
pub fn list_plugin_audit(
    app: tauri::AppHandle,
    plugin_id: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<PluginAuditEntry>, String> {
    let db = crate::local_store::connection(&app)?;
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let mut stmt=db.prepare("SELECT id,plugin_id,action,permission,success,error,created_at FROM plugin_audit_log WHERE (?1 IS NULL OR plugin_id=?1) ORDER BY created_at DESC LIMIT ?2").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map(params![plugin_id, limit], |r| {
            Ok(PluginAuditEntry {
                id: r.get(0)?,
                plugin_id: r.get(1)?,
                action: r.get(2)?,
                permission: r.get(3)?,
                success: r.get::<_, i64>(4)? != 0,
                error: r.get(5)?,
                created_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
#[tauri::command]
pub fn set_plugin_enabled(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, WasmRuntime>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    runtime.attach_app(app.clone());
    let db = crate::local_store::connection(&app)?;
    let operation = (|| {
        let (raw, path): (String, String) = db
            .query_row(
                "SELECT manifest_json,component_path FROM plugins WHERE id=?",
                [&id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| "plugin not found")?;
        if enabled {
            let manifest: PluginManifest = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            let current = read_plugin(&db, &id)?;
            runtime.start(
                &manifest,
                Path::new(&path),
                PluginContext::new(&id, current.grants),
            )?;
        } else {
            runtime.stop(&id)?;
        }
        db.execute(
            "UPDATE plugins SET enabled=?,status=?,last_error=NULL,updated_at=? WHERE id=?",
            params![
                enabled as i64,
                if enabled { "ENABLED" } else { "DISABLED" },
                chrono::Utc::now().timestamp(),
                id
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(error) = &operation {
        let _ = db.execute(
            "UPDATE plugins SET enabled=0,status='FAILED',last_error=?,updated_at=? WHERE id=?",
            params![error, chrono::Utc::now().timestamp(), id],
        );
    }
    audit(
        &db,
        &id,
        if enabled { "enable" } else { "disable" },
        None,
        &operation,
    );
    operation
}
#[tauri::command]
pub fn set_plugin_permission(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, WasmRuntime>,
    id: String,
    permission: PluginPermission,
    granted: bool,
) -> Result<(), String> {
    let db = crate::local_store::connection(&app)?;
    let name = serde_json::to_string(&permission)
        .map_err(|e| e.to_string())?
        .trim_matches('"')
        .to_string();
    let manifest: String = db
        .query_row("SELECT manifest_json FROM plugins WHERE id=?", [&id], |r| {
            r.get(0)
        })
        .map_err(|_| "plugin not found")?;
    let manifest: PluginManifest = serde_json::from_str(&manifest).map_err(|e| e.to_string())?;
    if !manifest.permissions.contains(&permission) {
        return Err("permission was not declared by the plugin".into());
    }
    runtime.attach_app(app.clone());
    let was_enabled: bool = db
        .query_row("SELECT enabled FROM plugins WHERE id=?", [&id], |r| {
            Ok(r.get::<_, i64>(0)? != 0)
        })
        .map_err(|e| e.to_string())?;
    if was_enabled {
        let _ = runtime.stop(&id);
    }
    let result = (|| {
        db.execute("INSERT INTO plugin_grants(plugin_id,permission,granted,updated_at) VALUES(?,?,?,?) ON CONFLICT(plugin_id,permission) DO UPDATE SET granted=excluded.granted,updated_at=excluded.updated_at",params![id,name,granted as i64,chrono::Utc::now().timestamp()]).map_err(|e|e.to_string())?;
        if was_enabled {
            db.execute("UPDATE plugins SET enabled=0,status='DISABLED',last_error=NULL,updated_at=? WHERE id=?",params![chrono::Utc::now().timestamp(),id]).map_err(|e|e.to_string())?;
        }
        Ok(())
    })();
    audit(&db, &id, "permission", Some(&name), &result);
    result
}
#[tauri::command]
pub fn dispatch_plugin_event(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, WasmRuntime>,
    id: String,
    kind: String,
    payload_json: String,
) -> Result<String, String> {
    runtime.attach_app(app.clone());
    let result = runtime.handle_event(&id, &kind, &payload_json);
    if let Ok(db) = crate::local_store::connection(&app) {
        audit(
            &db,
            &id,
            &format!("event:{kind}"),
            None,
            &result.as_ref().map(|_| ()).map_err(Clone::clone),
        );
    }
    result
}

pub(crate) fn dispatch_subscribed(app: &tauri::AppHandle, kind: &str, payload_json: &str) {
    let Some(runtime) = app.try_state::<WasmRuntime>() else {
        return;
    };
    runtime.attach_app(app.clone());
    let Ok(db) = crate::local_store::connection(app) else {
        return;
    };
    dispatch_subscribed_with(&db, &runtime, kind, payload_json);
}

/// Deliver `kind` to every enabled plugin subscribed to it.
///
/// Split out from [`dispatch_subscribed`] so the delivery path can be exercised
/// against an explicit connection + runtime, without a live `AppHandle`.
pub(crate) fn dispatch_subscribed_with(
    db: &rusqlite::Connection,
    runtime: &WasmRuntime,
    kind: &str,
    payload_json: &str,
) {
    let Ok(mut stmt) =
        db.prepare("SELECT id,manifest_json FROM plugins WHERE enabled=1 AND status='ENABLED'")
    else {
        return;
    };
    let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
    else {
        return;
    };
    let candidates = rows.filter_map(Result::ok).collect::<Vec<_>>();
    drop(stmt);
    for (id, raw) in candidates {
        let subscribed = serde_json::from_str::<PluginManifest>(&raw)
            .map(|m| m.events.iter().any(|event| event == kind))
            .unwrap_or(false);
        if !subscribed {
            continue;
        }
        let result = runtime.handle_event(&id, kind, payload_json).map(|_| ());
        if let Err(error) = &result {
            let _ = db.execute(
                "UPDATE plugins SET last_error=?,updated_at=? WHERE id=?",
                params![error, chrono::Utc::now().timestamp(), id],
            );
        }
        audit(db, &id, &format!("event:{kind}"), None, &result);
    }
}

/// Upper bound for a dispatched lifecycle payload. Mirrors the runtime's
/// `handle_event` guard so an oversized payload fails as a plain error (and is
/// audited) instead of trapping inside the guest.
pub(crate) const MAX_EVENT_PAYLOAD: usize = 64 * 1024;

/// Build a lifecycle event payload from bounded, non-body fields.
///
/// Document markdown is deliberately never included: it is unbounded, the audit
/// log and payload path are size-capped, and the runtime plan forbids recording
/// document bodies in plugin events. Each string field is truncated so a single
/// hostile field cannot blow the payload budget.
pub(crate) fn event_payload(fields: serde_json::Value) -> String {
    fn clamp(value: &mut serde_json::Value) {
        match value {
            serde_json::Value::String(text) => {
                if text.chars().count() > 512 {
                    let truncated: String = text.chars().take(512).collect();
                    *text = truncated;
                }
            }
            serde_json::Value::Object(map) => map.values_mut().for_each(clamp),
            serde_json::Value::Array(items) => items.iter_mut().for_each(clamp),
            _ => {}
        }
    }
    let mut value = fields;
    clamp(&mut value);
    let mut json = value.to_string();
    if json.len() > MAX_EVENT_PAYLOAD {
        // Fall back to a minimal envelope rather than truncating mid-JSON, which
        // would hand the guest an unparseable payload.
        json = serde_json::json!({"truncated": true}).to_string();
    }
    json
}

/// Build the `document.saved` payload from a persisted document.
///
/// `LocalDocument` fields are private to `local_store`, so the metadata is read
/// from its serialized form rather than by widening field visibility. Markdown
/// is explicitly dropped: it is unbounded, the audit log and payload path are
/// size-capped, and the runtime plan forbids recording document bodies in plugin
/// events.
pub(crate) fn notify_document_saved(
    app: &tauri::AppHandle,
    document: &crate::local_store::LocalDocument,
) {
    notify_document_event(app, document, "document.saved")
}

/// Dispatch `document.updated` for a metadata edit, with the same no-body rule.
pub(crate) fn notify_document_updated(
    app: &tauri::AppHandle,
    document: &crate::local_store::LocalDocument,
) {
    notify_document_event(app, document, "document.updated")
}

/// Build the bounded, body-free payload published for document lifecycle events.
///
/// `LocalDocument` fields are private to `local_store`, so metadata is read from
/// its serialized form rather than by widening field visibility. Markdown is
/// deliberately absent.
pub(crate) fn document_event_payload(
    document: &crate::local_store::LocalDocument,
) -> Option<String> {
    let value = serde_json::to_value(document).ok()?;
    Some(event_payload(serde_json::json!({
        "id": value.get("id"),
        "title": value.get("title"),
        "url": value.get("url"),
        "wordCount": value.get("wordCount"),
        "status": value.get("status"),
    })))
}

fn notify_document_event(
    app: &tauri::AppHandle,
    document: &crate::local_store::LocalDocument,
    kind: &str,
) {
    if let Some(payload) = document_event_payload(document) {
        dispatch_subscribed(app, kind, &payload);
    }
}

#[tauri::command]
pub fn uninstall_plugin(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, WasmRuntime>,
    id: String,
) -> Result<(), String> {
    let db = crate::local_store::connection(&app)?;
    let path: String = db
        .query_row(
            "SELECT component_path FROM plugins WHERE id=?",
            [&id],
            |r| r.get(0),
        )
        .map_err(|_| "plugin not found")?;
    runtime.stop(&id)?;
    audit(&db, &id, "uninstall", None, &Ok(()));
    db.execute("DELETE FROM plugins WHERE id=?", [&id])
        .map_err(|e| e.to_string())?;
    if let Some(version) = Path::new(&path).parent() {
        let _ = fs::remove_dir_all(version);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_store::{run_migrations, write_document, LocalDocument};

    fn manifest() -> PluginManifest {
        PluginManifest {
            schema_version: 1,
            id: "com.arcadia.hello".into(),
            name: "Hello".into(),
            version: "1.0.0".into(),
            description: None,
            author: None,
            component: "plugin.wasm".into(),
            sha256: "0".repeat(64),
            permissions: vec![],
            network_allowlist: vec![],
            events: vec!["document.saved".into()],
            ui_contributions: vec![],
        }
    }

    fn document() -> LocalDocument {
        serde_json::from_value(serde_json::json!({
            "id": "local-e2e-1",
            "title": "Plugin lifecycle E2E",
            "url": "https://example.com/lifecycle",
            "source": "example.com",
            "markdown": "SECRET-BODY-MARKER that must never reach a plugin",
            "wordCount": 42,
            "status": "READY",
            "tags": ["e2e"],
            "autoTags": [],
            "createdAt": "2026-10-07T00:00:00.000Z",
            "starred": false
        }))
        .expect("document fixture")
    }

    /// A migrated in-memory database with `com.arcadia.hello` installed and
    /// enabled, subscribed to `document.saved`.
    fn seeded_database() -> rusqlite::Connection {
        let mut database = rusqlite::Connection::open_in_memory().expect("open in-memory db");
        run_migrations(&mut database).expect("run migrations");
        let manifest = manifest();
        let json = serde_json::to_string(&manifest).expect("serialize manifest");
        let now = chrono::Utc::now().timestamp();
        database
            .execute(
                "INSERT INTO plugins(id,name,version,manifest_json,component_path,sha256,status,enabled,installed_at,updated_at) \
                 VALUES(?,?,?,?,?,?,'ENABLED',1,?,?)",
                params![
                    manifest.id,
                    manifest.name,
                    manifest.version,
                    json,
                    "plugin.wasm",
                    manifest.sha256,
                    now,
                    now
                ],
            )
            .expect("insert plugin row");
        database
    }

    fn running_runtime() -> (WasmRuntime, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!("arcadia-e2e-{}.wasm", uuid::Uuid::new_v4()));
        std::fs::write(
            &path,
            include_bytes!("../../samples/hello-plugin/plugin.wasm"),
        )
        .expect("stage sample plugin");
        let runtime = WasmRuntime::default();
        runtime
            .start(
                &manifest(),
                &path,
                PluginContext::new("com.arcadia.hello", []),
            )
            .expect("start hello plugin");
        (runtime, path)
    }

    /// End-to-end: persist a document through the real write path, then confirm a
    /// genuinely running WASM plugin received `document.saved` with a correct,
    /// body-free payload.
    #[test]
    fn saving_a_document_notifies_a_subscribed_plugin() {
        let database = seeded_database();
        let (runtime, path) = running_runtime();

        let saved = document();
        write_document(&database, &saved).expect("write document");
        let payload = document_event_payload(&saved).expect("build event payload");
        dispatch_subscribed_with(&database, &runtime, "document.saved", &payload);

        // The row really landed in the database...
        let count: i64 = database
            .query_row(
                "SELECT COUNT(*) FROM local_documents WHERE id='local-e2e-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "document must be persisted");

        // ...and the guest echoed back the exact payload it was handed.
        let echoed = runtime
            .handle_event("com.arcadia.hello", "document.saved", &payload)
            .unwrap();
        assert_eq!(echoed, format!("handled:document.saved:{payload}"));

        let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(value["id"], "local-e2e-1");
        assert_eq!(value["title"], "Plugin lifecycle E2E");
        assert_eq!(value["url"], "https://example.com/lifecycle");
        assert_eq!(value["wordCount"], 42);
        assert!(
            !payload.contains("SECRET-BODY-MARKER"),
            "document body must never be published to plugins"
        );
        assert!(
            value.get("markdown").is_none(),
            "payload must not carry a markdown field at all"
        );

        // The dispatch is audited, which is what surfaces a trapping plugin.
        let audited: i64 = database
            .query_row(
                "SELECT COUNT(*) FROM plugin_audit_log WHERE plugin_id='com.arcadia.hello' AND action='event:document.saved' AND success=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(audited, 1, "successful dispatch must be audited");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn unsubscribed_plugins_are_not_disturbed() {
        let mut manifest = manifest();
        manifest.events = vec!["ui.command".into()];
        let database = seeded_database();
        let json = serde_json::to_string(&manifest).unwrap();
        database
            .execute(
                "UPDATE plugins SET manifest_json=? WHERE id='com.arcadia.hello'",
                params![json],
            )
            .unwrap();
        let (runtime, path) = running_runtime();

        let saved = document();
        let payload = document_event_payload(&saved).unwrap();
        dispatch_subscribed_with(&database, &runtime, "document.saved", &payload);

        let audited: i64 = database
            .query_row(
                "SELECT COUNT(*) FROM plugin_audit_log WHERE action='event:document.saved'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(audited, 0, "a plugin that did not subscribe is not called");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_trapping_plugin_never_breaks_the_write_path() {
        let database = seeded_database();
        let payload = document_event_payload(&document()).unwrap();
        // No runtime is attached, so `handle_event` fails for every plugin.
        // Dispatch must still return normally so the caller can proceed.
        let runtime = WasmRuntime::default();
        write_document(&database, &document()).expect("write must still succeed");
        dispatch_subscribed_with(&database, &runtime, "document.saved", &payload);

        let count: i64 = database
            .query_row(
                "SELECT COUNT(*) FROM local_documents WHERE id='local-e2e-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);

        let failures: i64 = database
            .query_row(
                "SELECT COUNT(*) FROM plugin_audit_log WHERE action='event:document.saved' AND success=0",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(failures, 1, "the failure is recorded as an audit entry");
    }

    #[test]
    fn oversized_fields_are_clamped_into_a_valid_payload() {
        let saved: LocalDocument = serde_json::from_value(serde_json::json!({
            "id": "local-big",
            "title": "x".repeat(4096),
            "url": "https://example.com/big",
            "markdown": "y".repeat(MAX_EVENT_PAYLOAD * 2),
            "wordCount": 1,
            "status": "READY",
            "tags": [],
            "autoTags": [],
            "createdAt": "2026-10-07T00:00:00.000Z",
            "starred": false
        }))
        .expect("oversized document fixture");
        let payload = document_event_payload(&saved).expect("payload");
        let value: serde_json::Value =
            serde_json::from_str(&payload).expect("payload must stay parseable after clamping");
        assert_eq!(value["title"].as_str().unwrap().chars().count(), 512);
        assert!(
            !payload.contains(&"y".repeat(1024)),
            "oversized body must not be published"
        );
    }

    #[test]
    fn permission_gate_blocks_ungranted_knowledge_read() {
        // `Host::knowledge_search` calls `context.require(knowledge_read)` before
        // touching the database; with no grant it must fail.
        let context = PluginContext::new("com.arcadia.hello", []);
        assert!(context.require(PluginPermission::KnowledgeRead).is_err());
        let granted = PluginContext::new("com.arcadia.hello", [PluginPermission::KnowledgeRead]);
        assert!(granted.require(PluginPermission::KnowledgeRead).is_ok());
        assert!(granted.require(PluginPermission::KnowledgeWrite).is_err());
    }
}
