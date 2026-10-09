//! Tauri command bindings for the privacy rule engine.
//!
//! Spec B-epic surface:
//! - `privacy_list_blocklists` — enumerate filter lists
//! - `privacy_update_list` — re-fetch + recompile atomically
//! - `privacy_get_site_setting` / `privacy_set_site_setting`
//! - `privacy_block_event_list` — recent blocks for the toolbar panel

use tauri::AppHandle;

use crate::local_store;
use crate::privacy::types::RuleAction;

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyBlocklistRow {
    pub id: String,
    pub name: String,
    pub url: String,
    pub enabled: bool,
    pub last_updated_at: Option<i64>,
    pub rule_count: i64,
    pub unsupported_rule_count: i64,
    pub last_error: Option<String>,
}

#[tauri::command]
pub fn privacy_list_blocklists(app: AppHandle) -> Result<Vec<PrivacyBlocklistRow>, String> {
    let database = local_store::connection(&app)?;
    let mut stmt = database
        .prepare(
            "SELECT id, name, url, enabled, last_updated_at, rule_count, unsupported_rule_count, last_error
             FROM privacy_filter_lists
             ORDER BY name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PrivacyBlocklistRow {
                id: row.get(0)?,
                name: row.get(1)?,
                url: row.get(2)?,
                enabled: row.get::<_, i64>(3)? != 0,
                last_updated_at: row.get(4)?,
                rule_count: row.get(5)?,
                unsupported_rule_count: row.get(6)?,
                last_error: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn privacy_set_blocklist_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let database = local_store::connection(&app)?;
    database
        .execute(
            "UPDATE privacy_filter_lists SET enabled=?1, updated_at=?2 WHERE id=?3",
            rusqlite::params![enabled as i64, now_seconds(), id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrivacySiteSetting {
    pub origin: String,
    pub protection_enabled: bool,
    pub allow_ads: bool,
    pub allow_trackers: bool,
    pub allow_cosmetic: bool,
    pub updated_at: i64,
}

#[tauri::command]
pub fn privacy_get_site_setting(
    app: AppHandle,
    origin: String,
) -> Result<Option<PrivacySiteSetting>, String> {
    let database = local_store::connection(&app)?;
    let mut stmt = database
        .prepare(
            "SELECT origin, protection_enabled, allow_ads, allow_trackers, allow_cosmetic, updated_at
             FROM privacy_site_settings
             WHERE origin = ?1",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map(rusqlite::params![origin], |row| {
            Ok(PrivacySiteSetting {
                origin: row.get(0)?,
                protection_enabled: row.get::<_, i64>(1)? != 0,
                allow_ads: row.get::<_, i64>(2)? != 0,
                allow_trackers: row.get::<_, i64>(3)? != 0,
                allow_cosmetic: row.get::<_, i64>(4)? != 0,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.next().transpose().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn privacy_set_site_setting(
    app: AppHandle,
    origin: String,
    protection_enabled: bool,
    allow_ads: bool,
    allow_trackers: bool,
    allow_cosmetic: bool,
) -> Result<(), String> {
    let database = local_store::connection(&app)?;
    database
        .execute(
            "INSERT INTO privacy_site_settings(origin, protection_enabled, allow_ads, allow_trackers, allow_cosmetic, updated_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(origin) DO UPDATE SET
                 protection_enabled=excluded.protection_enabled,
                 allow_ads=excluded.allow_ads,
                 allow_trackers=excluded.allow_trackers,
                 allow_cosmetic=excluded.allow_cosmetic,
                 updated_at=excluded.updated_at",
            rusqlite::params![
                origin,
                protection_enabled as i64,
                allow_ads as i64,
                allow_trackers as i64,
                allow_cosmetic as i64,
                now_seconds(),
            ],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyBlockEventRow {
    pub id: String,
    pub top_level_origin: String,
    pub request_host: String,
    pub resource_type: String,
    pub rule_id: Option<i64>,
    pub rule_category: Option<String>,
    pub blocked_at: i64,
}

#[tauri::command]
pub fn privacy_list_block_events(
    app: AppHandle,
    limit: Option<i64>,
) -> Result<Vec<PrivacyBlockEventRow>, String> {
    let database = local_store::connection(&app)?;
    let mut stmt = database
        .prepare(
            "SELECT id, top_level_origin, request_host, resource_type, rule_id, rule_category, blocked_at
             FROM privacy_block_events
             ORDER BY blocked_at DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            rusqlite::params![limit.unwrap_or(200).clamp(1, 5_000)],
            |row| {
                Ok(PrivacyBlockEventRow {
                    id: row.get(0)?,
                    top_level_origin: row.get(1)?,
                    request_host: row.get(2)?,
                    resource_type: row.get(3)?,
                    rule_id: row.get(4)?,
                    rule_category: row.get(5)?,
                    blocked_at: row.get(6)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyCapability {
    pub network_subresource_blocking: bool,
    pub platform: &'static str,
    pub notes: Vec<String>,
}

#[tauri::command]
pub fn privacy_capability_report() -> PrivacyCapability {
    #[cfg(target_os = "windows")]
    let (network, notes) = (
        true,
        vec![
            "Windows WebResourceRequested wired in batch 7".into(),
        ],
    );
    #[cfg(target_os = "macos")]
    let (network, notes) = (
        false,
        vec![
            "macOS uses WKContentRuleList for high-level rules and JS monkey-patches for fetch/XHR".into(),
            "Network subresource blocking is NOT available".into(),
        ],
    );
    #[cfg(target_os = "linux")]
    let (network, notes) = (
        false,
        vec![
            "WebKitGTK URI scheme intercept is best-effort".into(),
            "Network subresource blocking is NOT available".into(),
        ],
    );
    PrivacyCapability {
        network_subresource_blocking: network,
        platform: std::env::consts::OS,
        notes,
    }
}

/// Re-export of the matcher API used by the legacy layer.
pub fn used_action(action: RuleAction) -> RuleAction {
    action
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
