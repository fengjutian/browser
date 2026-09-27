use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE};
use rusqlite::params;
use serde_json::{json, Value};
use std::str::FromStr;
use std::time::Duration;

const PROTOCOL_VERSION: &str = "2026-07-28";

struct HttpServer { url: String, headers: HeaderMap }

fn load_server(app: &tauri::AppHandle, id: &str) -> Result<HttpServer, String> {
    let db = crate::local_store::connection(app)?;
    let (transport, url, raw_headers, enabled): (String, Option<String>, String, i64) = db
        .query_row("SELECT transport,url,headers_json,enabled FROM mcp_servers WHERE id=?", params![id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
        .map_err(|_| "MCP server not found".to_string())?;
    if enabled == 0 { return Err("MCP server is disabled".into()) }
    if transport != "http" { return Err(format!("MCP transport '{transport}' is not connected yet")) }
    let url = url.ok_or_else(|| "MCP server URL is missing".to_string())?;
    let parsed = url::Url::parse(&url).map_err(|e| format!("invalid MCP URL: {e}"))?;
    let loopback = parsed.host_str().is_some_and(|host| host == "localhost" || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback()));
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) { return Err("remote MCP URLs must use HTTPS".into()) }
    let values: std::collections::HashMap<String, String> = serde_json::from_str(&raw_headers).map_err(|e| e.to_string())?;
    let mut headers = HeaderMap::new();
    for (name, value) in values {
        let lower = name.to_ascii_lowercase();
        if matches!(lower.as_str(), "host" | "content-length" | "mcp-protocol-version" | "mcp-method" | "mcp-name") { return Err(format!("reserved MCP header: {name}")) }
        headers.insert(HeaderName::from_str(&name).map_err(|e| e.to_string())?, HeaderValue::from_str(&value).map_err(|e| e.to_string())?);
    }
    Ok(HttpServer { url, headers })
}

fn parse_response(text: &str) -> Result<Value, String> {
    let trimmed = text.trim();
    let payload = if trimmed.lines().any(|line| line.starts_with("data:")) {
        trimmed.lines().filter_map(|line| line.strip_prefix("data:").map(str::trim)).find(|line| !line.is_empty() && *line != "[DONE]").ok_or("empty MCP SSE response")?
    } else { trimmed };
    let value: Value = serde_json::from_str(payload).map_err(|e| format!("invalid MCP response: {e}"))?;
    if let Some(error) = value.get("error") { return Err(format!("MCP error: {error}")) }
    value.get("result").cloned().ok_or_else(|| "MCP response has no result".into())
}

async fn request(app: &tauri::AppHandle, server_id: &str, method: &str, params_value: Value, name: Option<&str>) -> Result<Value, String> {
    let server = load_server(app, server_id)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(45)).build().map_err(|e| e.to_string())?;
    let mut request = client.post(server.url).headers(server.headers).header(CONTENT_TYPE, "application/json").header(ACCEPT, "application/json, text/event-stream").header("MCP-Protocol-Version", PROTOCOL_VERSION).header("Mcp-Method", method);
    if let Some(name) = name { request = request.header("Mcp-Name", name) }
    let body = json!({"jsonrpc":"2.0","id":uuid::Uuid::new_v4().to_string(),"method":method,"params":params_value});
    let response = request.json(&body).send().await.map_err(|e| format!("MCP connection failed: {e}"))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(format!("MCP HTTP {}: {}", status.as_u16(), text.chars().take(400).collect::<String>())) }
    parse_response(&text)
}

fn audit(app: &tauri::AppHandle, server_id: &str, method: &str, name: Option<&str>, approved: bool, result: &Result<Value, String>) {
    if let Ok(db) = crate::local_store::connection(app) {
        let _ = db.execute("INSERT INTO mcp_audit_log(id,server_id,method,target_name,approved,success,error,created_at) VALUES(?,?,?,?,?,?,?,?)", params![uuid::Uuid::new_v4().to_string(), server_id, method, name, approved as i64, result.is_ok() as i64, result.as_ref().err(), chrono::Utc::now().to_rfc3339()]);
    }
}

#[tauri::command] pub async fn mcp_discover(app: tauri::AppHandle, server_id: String) -> Result<Value,String> { request(&app,&server_id,"server/discover",json!({}),None).await }
#[tauri::command] pub async fn mcp_list_tools(app: tauri::AppHandle, server_id: String) -> Result<Value,String> { request(&app,&server_id,"tools/list",json!({}),None).await }
#[tauri::command] pub async fn mcp_list_resources(app: tauri::AppHandle, server_id: String) -> Result<Value,String> { request(&app,&server_id,"resources/list",json!({}),None).await }

#[tauri::command]
pub async fn mcp_call_tool(app: tauri::AppHandle, server_id: String, name: String, arguments: Value, approved: bool) -> Result<Value,String> {
    if !approved { let result=Err("MCP tool call requires explicit approval".into()); audit(&app,&server_id,"tools/call",Some(&name),false,&result); return result }
    let result=request(&app,&server_id,"tools/call",json!({"name":name,"arguments":arguments}),Some(&name)).await;
    audit(&app,&server_id,"tools/call",Some(&name),true,&result); result
}

#[cfg(test)] mod tests { use super::*; #[test] fn parses_json_and_sse(){ assert_eq!(parse_response(r#"{"jsonrpc":"2.0","result":{"ok":true}}"#).unwrap()["ok"],true); assert_eq!(parse_response("event: message\ndata: {\"result\":{\"ok\":true}}\n").unwrap()["ok"],true); } }
