use super::PluginPermission;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PluginManifest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub component: String,
    pub sha256: String,
    #[serde(default)]
    pub permissions: Vec<PluginPermission>,
    #[serde(default, rename = "networkAllowlist")]
    pub network_allowlist: Vec<String>,
    #[serde(default)]
    pub events: Vec<String>,
}

impl PluginManifest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.schema_version != 1 { return Err("unsupported plugin manifest schema") }
        if self.id.len() > 200 || !self.id.split('.').all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')) || !self.id.contains('.') {
            return Err("plugin id must be reverse-domain style");
        }
        if self.name.trim().is_empty() || self.name.len() > 200 || !valid_semver(&self.version) {
            return Err("plugin name and version are required");
        }
        if self.component != "plugin.wasm" { return Err("component must be plugin.wasm") }
        if self.sha256.len() != 64 || !self.sha256.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("sha256 must be 64 hexadecimal characters") }
        if self.permissions.len() > 32 || self.events.len() > 64 || self.network_allowlist.len() > 64 { return Err("manifest list limit exceeded") }
        if !self.network_allowlist.is_empty() && !self.permissions.contains(&PluginPermission::NetworkRequest) { return Err("network allowlist requires network_request permission") }
        if self.network_allowlist.iter().any(|host| host.is_empty() || host.contains('/') || host.contains(':') || host.contains('*')) { return Err("network allowlist entries must be exact host names") }
        Ok(())
    }
}

fn valid_semver(value: &str) -> bool {
    let core=value.split_once('-').map(|v|v.0).unwrap_or(value);
    let parts=core.split('.').collect::<Vec<_>>();
    parts.len()==3 && parts.iter().all(|part| !part.is_empty() && part.bytes().all(|b|b.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn manifest() -> PluginManifest { PluginManifest { schema_version:1,id:"com.example.test".into(),name:"Test".into(),version:"1.0.0".into(),description:None,author:None,component:"plugin.wasm".into(),sha256:"a".repeat(64),permissions:vec![],network_allowlist:vec![],events:vec![] } }
    #[test] fn accepts_v1_manifest(){ assert!(manifest().validate().is_ok()); }
    #[test] fn network_hosts_require_permission(){ let mut value=manifest();value.network_allowlist.push("api.example.com".into());assert!(value.validate().is_err()); }
    #[test] fn rejects_component_path_escape(){ let mut value=manifest();value.component="../plugin.wasm".into();assert!(value.validate().is_err()); }
}
