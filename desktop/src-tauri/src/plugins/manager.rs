use super::{PluginManifest, PluginRuntime};
use std::collections::HashMap;

pub struct PluginManager<R: PluginRuntime> {
    registry: HashMap<String, PluginManifest>,
    runtime: R,
}
impl<R: PluginRuntime> PluginManager<R> {
    pub fn new(runtime: R) -> Self {
        Self {
            registry: HashMap::new(),
            runtime,
        }
    }
    pub fn register(&mut self, manifest: PluginManifest) -> Result<(), String> {
        manifest.validate().map_err(str::to_string)?;
        if self.registry.contains_key(&manifest.id) {
            return Err("plugin already registered".into());
        }
        self.registry.insert(manifest.id.clone(), manifest);
        Ok(())
    }
    pub fn list(&self) -> Vec<&PluginManifest> {
        self.registry.values().collect()
    }
    pub fn start(&self,id:&str,component_path:&std::path::Path,context:super::PluginContext)->Result<(),String>{let manifest=self.registry.get(id).ok_or("plugin is not registered")?;self.runtime.start(manifest,component_path,context)}
    pub fn handle_event(&self,id:&str,kind:&str,payload_json:&str)->Result<String,String>{self.runtime.handle_event(id,kind,payload_json)}
    pub fn stop(&self,id:&str)->Result<(),String>{self.runtime.stop(id)}
}
