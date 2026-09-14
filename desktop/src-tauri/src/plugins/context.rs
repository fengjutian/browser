use std::collections::HashSet;
use super::PluginPermission;

pub struct PluginContext { plugin_id: String, granted: HashSet<PluginPermission> }
impl PluginContext {
    pub fn new(plugin_id: impl Into<String>, granted: impl IntoIterator<Item=PluginPermission>) -> Self { Self { plugin_id: plugin_id.into(), granted: granted.into_iter().collect() } }
    pub fn plugin_id(&self) -> &str { &self.plugin_id }
    pub fn require(&self, permission: PluginPermission) -> Result<(), String> { if self.granted.contains(&permission) { Ok(()) } else { Err(format!("plugin {} lacks permission {:?}", self.plugin_id, permission)) } }
}
