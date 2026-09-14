use super::{PluginContext, PluginManifest};

pub trait PluginRuntime: Send + Sync { fn start(&self, manifest: &PluginManifest, context: &PluginContext) -> Result<(), String>; fn stop(&self, plugin_id: &str) -> Result<(), String>; }
pub struct DisabledRuntime;
impl PluginRuntime for DisabledRuntime {
    fn start(&self, _manifest:&PluginManifest, _context:&PluginContext)->Result<(),String>{Err("plugin runtime is not available in V1".into())}
    fn stop(&self, _plugin_id:&str)->Result<(),String>{Ok(())}
}
