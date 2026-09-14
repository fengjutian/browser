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
    pub fn runtime(&self) -> &R {
        &self.runtime
    }
}
