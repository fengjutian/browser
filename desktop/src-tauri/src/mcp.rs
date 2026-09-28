use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE};
use rusqlite::params;
use serde_json::{json, Value};
use std::str::FromStr;
use std::time::Duration;
use std::io::{BufRead, BufReader, Write};

const PROTOCOL_VERSION: &str = "2026-07-28";

struct McpServer {
    transport: String,
    url: Option<String>,
    command: Option<String>,
    args: Vec<String>,
    env: std::collections::HashMap<String, String>,
    headers: HeaderMap,
}

fn load_server(app: &tauri::AppHandle, id: &str) -> Result<McpServer, String> {
    let db = crate::local_store::connection(app)?;
    let (transport, command, url, raw_args, raw_env, raw_headers, enabled): (String, Option<String>, Option<String>, String, String, String, i64) = db
        .query_row("SELECT transport,command,url,args_json,env_json,headers_json,enabled FROM mcp_servers WHERE id=?", params![id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)))
        .map_err(|_| "MCP server not found".to_string())?;
    if enabled == 0 { return Err("MCP server is disabled".into()) }
    if !matches!(transport.as_str(), "stdio" | "http" | "sse") { return Err(format!("unsupported MCP transport '{transport}'")) }
    if transport != "stdio" {
        let parsed = url::Url::parse(url.as_deref().ok_or("MCP server URL is missing")?).map_err(|e| format!("invalid MCP URL: {e}"))?;
        let loopback = parsed.host_str().is_some_and(|host| host == "localhost" || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback()));
        if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) { return Err("remote MCP URLs must use HTTPS".into()) }
    }
    let values: std::collections::HashMap<String, String> = serde_json::from_str(&raw_headers).map_err(|e| e.to_string())?;
    let mut headers = HeaderMap::new();
    for (name, value) in values {
        let lower = name.to_ascii_lowercase();
        if matches!(lower.as_str(), "host" | "content-length" | "mcp-protocol-version" | "mcp-method" | "mcp-name") { return Err(format!("reserved MCP header: {name}")) }
        headers.insert(HeaderName::from_str(&name).map_err(|e| e.to_string())?, HeaderValue::from_str(&value).map_err(|e| e.to_string())?);
    }
    Ok(McpServer {
        transport, url, command,
        args: serde_json::from_str(&raw_args).map_err(|e| e.to_string())?,
        env: serde_json::from_str(&raw_env).map_err(|e| e.to_string())?,
        headers,
    })
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
    if server.transport == "stdio" {
        return request_stdio(server, method, params_value).await;
    }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(45)).build().map_err(|e| e.to_string())?;
    let mut request = client.post(server.url.ok_or("MCP server URL is missing")?).headers(server.headers).header(CONTENT_TYPE, "application/json").header(ACCEPT, "application/json, text/event-stream").header("MCP-Protocol-Version", PROTOCOL_VERSION).header("Mcp-Method", method);
    if let Some(name) = name { request = request.header("Mcp-Name", name) }
    let body = json!({"jsonrpc":"2.0","id":uuid::Uuid::new_v4().to_string(),"method":method,"params":params_value});
    let response = request.json(&body).send().await.map_err(|e| format!("MCP connection failed: {e}"))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(format!("MCP HTTP {}: {}", status.as_u16(), text.chars().take(400).collect::<String>())) }
    parse_response(&text)
}

async fn request_stdio(server: McpServer, method: &str, params_value: Value) -> Result<Value, String> {
    let method = method.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let executable = server.command.as_deref().filter(|v| !v.trim().is_empty()).ok_or("MCP stdio command is missing")?;
        let mut child = std::process::Command::new(executable).args(&server.args).envs(&server.env)
            .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped())
            .spawn().map_err(|e| format!("MCP stdio launch failed: {e}"))?;
        let mut stdin = child.stdin.take().ok_or("MCP stdio stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("MCP stdio stdout unavailable")?;
        let id = uuid::Uuid::new_v4().to_string();
        let body = serde_json::to_string(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params_value})).map_err(|e| e.to_string())?;
        writeln!(stdin, "{body}").map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
        for line in BufReader::new(stdout).lines() {
            let line = line.map_err(|e| e.to_string())?;
            let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
            if value.get("id").and_then(Value::as_str) != Some(id.as_str()) { continue }
            let _ = child.kill();
            if let Some(error) = value.get("error") { return Err(format!("MCP error: {error}")); }
            return value.get("result").cloned().ok_or_else(|| "MCP response has no result".into());
        }
        let _ = child.kill();
        Err("MCP stdio server closed without a response".into())
    }).await.map_err(|e| e.to_string())?
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
