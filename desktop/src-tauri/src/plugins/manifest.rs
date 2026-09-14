use super::PluginPermission;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    #[serde(default)]
    pub permissions: Vec<PluginPermission>,
}

impl PluginManifest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.id.trim().is_empty() || !self.id.contains('.') {
            return Err("plugin id must be reverse-domain style");
        }
        if self.name.trim().is_empty() || self.version.trim().is_empty() {
            return Err("plugin name and version are required");
        }
        Ok(())
    }
}
