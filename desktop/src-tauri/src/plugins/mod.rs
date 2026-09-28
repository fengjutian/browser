mod context;
pub(crate) mod installer;
mod manager;
mod manifest;
mod permission;
mod runtime;

pub use context::PluginContext;
pub use installer::{
    dispatch_plugin_event, install_plugin, list_plugin_audit, list_plugins, set_plugin_enabled,
    set_plugin_permission, uninstall_plugin, InstalledPlugin, PluginAuditEntry,
};
pub use manager::PluginManager;
pub use manifest::PluginManifest;
pub use permission::PluginPermission;
pub use runtime::{DisabledRuntime, PluginRuntime, WasmRuntime};
