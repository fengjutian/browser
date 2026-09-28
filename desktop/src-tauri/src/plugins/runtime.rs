use super::{PluginContext, PluginManifest, PluginPermission};
use serde::Deserialize;
use std::{collections::HashMap, path::Path, sync::Mutex, time::Duration};
use wasmtime::{
    component::{Component, HasSelf, Linker},
    Config, Engine, Store, StoreLimits, StoreLimitsBuilder,
};

mod bindings {
    wasmtime::component::bindgen!({ path: "wit", world: "arcadia-plugin" });
}

const FUEL: u64 = 10_000_000;
const MEMORY_BYTES: usize = 64 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(5);

struct HostState {
    context: PluginContext,
    limits: StoreLimits,
    app: Option<tauri::AppHandle>,
    network_allowlist: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiRequest {
    provider_id: String,
    request: crate::providers::ChatRequest,
}
#[derive(Deserialize)]
struct HttpRequest {
    url: String,
    #[serde(default = "default_method")]
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<String>,
}
fn default_method() -> String {
    "GET".into()
}

impl bindings::arcadia::plugin::host::Host for HostState {
    fn log(&mut self, level: String, message: String) -> Result<(), String> {
        if message.len() > 16 * 1024 {
            return Err("log message exceeds 16 KiB".into());
        }
        eprintln!("plugin[{}] {level}: {message}", self.context.plugin_id());
        Ok(())
    }
    fn knowledge_search(&mut self, query: String, limit: u32) -> Result<String, String> {
        self.context.require(PluginPermission::KnowledgeRead)?;
        let app = self.app.clone().ok_or("host application is unavailable")?;
        let mut rows = crate::local_store::local_list_documents(app, query)?;
        rows.truncate(limit.clamp(1, 50) as usize);
        serde_json::to_string(&rows).map_err(|e| e.to_string())
    }
    fn knowledge_get(&mut self, id: String) -> Result<String, String> {
        self.context.require(PluginPermission::KnowledgeRead)?;
        let app = self.app.clone().ok_or("host application is unavailable")?;
        serde_json::to_string(&crate::local_store::local_get_document(app, id)?)
            .map_err(|e| e.to_string())
    }
    fn knowledge_save(&mut self, document_json: String) -> Result<String, String> {
        self.context.require(PluginPermission::KnowledgeWrite)?;
        if document_json.len() > 2 * 1024 * 1024 {
            return Err("document exceeds 2 MiB".into());
        }
        let app = self.app.clone().ok_or("host application is unavailable")?;
        let document =
            serde_json::from_str(&document_json).map_err(|e| format!("invalid document: {e}"))?;
        serde_json::to_string(&crate::local_store::save_document_inner(&app, document)?)
            .map_err(|e| e.to_string())
    }
    fn ai_chat(&mut self, request_json: String) -> Result<String, String> {
        self.context.require(PluginPermission::AiChat)?;
        if request_json.len() > 256 * 1024 {
            return Err("AI request exceeds 256 KiB".into());
        }
        let app = self.app.clone().ok_or("host application is unavailable")?;
        let value: AiRequest =
            serde_json::from_str(&request_json).map_err(|e| format!("invalid AI request: {e}"))?;
        let response =
            tauri::async_runtime::block_on(crate::ai_chat(app, value.provider_id, value.request))?;
        serde_json::to_string(&response).map_err(|e| e.to_string())
    }
    fn http_fetch(&mut self, request_json: String) -> Result<String, String> {
        self.context.require(PluginPermission::NetworkRequest)?;
        if request_json.len() > 1024 * 1024 {
            return Err("HTTP request exceeds 1 MiB".into());
        }
        let value: HttpRequest = serde_json::from_str(&request_json)
            .map_err(|e| format!("invalid HTTP request: {e}"))?;
        let url = url::Url::parse(&value.url).map_err(|e| e.to_string())?;
        if url.scheme() != "https" {
            return Err("only HTTPS is allowed".into());
        }
        let host = url.host_str().ok_or("URL has no host")?;
        if !self
            .network_allowlist
            .iter()
            .any(|allowed| allowed.eq_ignore_ascii_case(host))
        {
            return Err("host is not in the plugin network allowlist".into());
        }
        let method =
            reqwest::Method::from_bytes(value.method.as_bytes()).map_err(|e| e.to_string())?;
        if !matches!(
            method,
            reqwest::Method::GET
                | reqwest::Method::POST
                | reqwest::Method::PUT
                | reqwest::Method::PATCH
                | reqwest::Method::DELETE
        ) {
            return Err("HTTP method is not allowed".into());
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| e.to_string())?;
        let mut request = client.request(method, url);
        for (name, val) in value.headers {
            if name.eq_ignore_ascii_case("authorization") || name.eq_ignore_ascii_case("cookie") {
                return Err("sensitive request header is not allowed".into());
            }
            request = request.header(name, val)
        }
        if let Some(body) = value.body {
            request = request.body(body)
        }
        let (status,headers,bytes)=tauri::async_runtime::block_on(async move {let response=request.send().await.map_err(|e|e.to_string())?;let status=response.status().as_u16();let headers=response.headers().iter().map(|(k,v)|(k.to_string(),v.to_str().unwrap_or("").to_string())).collect::<HashMap<_,_>>();let bytes=response.bytes().await.map_err(|e|e.to_string())?;Ok::<_,String>((status,headers,bytes))})?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err("HTTP response exceeds 8 MiB".into());
        }
        Ok(serde_json::json!({"status":status,"headers":headers,"body":String::from_utf8_lossy(&bytes)}).to_string())
    }
}

pub trait PluginRuntime: Send + Sync {
    fn start(
        &self,
        manifest: &PluginManifest,
        component_path: &Path,
        context: PluginContext,
    ) -> Result<(), String>;
    fn handle_event(
        &self,
        plugin_id: &str,
        kind: &str,
        payload_json: &str,
    ) -> Result<String, String>;
    fn stop(&self, plugin_id: &str) -> Result<(), String>;
}

struct RunningInstance {
    engine: Engine,
    store: Store<HostState>,
    guest: bindings::ArcadiaPlugin,
}
pub struct WasmRuntime {
    instances: Mutex<HashMap<String, RunningInstance>>,
    app: Mutex<Option<tauri::AppHandle>>,
}
impl Default for WasmRuntime {
    fn default() -> Self {
        Self {
            instances: Mutex::new(HashMap::new()),
            app: Mutex::new(None),
        }
    }
}

impl WasmRuntime {
    pub fn attach_app(&self, app: tauri::AppHandle) {
        if let Ok(mut slot) = self.app.lock() {
            *slot = Some(app)
        }
    }
    fn engine() -> Result<Engine, String> {
        let mut config = Config::new();
        config
            .wasm_component_model(true)
            .consume_fuel(true)
            .epoch_interruption(true);
        Engine::new(&config).map_err(|e| e.to_string())
    }
    fn arm_timeout(engine: Engine) {
        std::thread::spawn(move || {
            std::thread::sleep(TIMEOUT);
            engine.increment_epoch();
        });
    }
    fn prepare(store: &mut Store<HostState>, engine: &Engine) -> Result<(), String> {
        store.set_fuel(FUEL).map_err(|e| e.to_string())?;
        store.set_epoch_deadline(1);
        Self::arm_timeout(engine.clone());
        Ok(())
    }
}

impl PluginRuntime for WasmRuntime {
    fn start(
        &self,
        manifest: &PluginManifest,
        component_path: &Path,
        context: PluginContext,
    ) -> Result<(), String> {
        manifest.validate().map_err(str::to_string)?;
        let engine = Self::engine()?;
        let component = Component::from_file(&engine, component_path)
            .map_err(|e| format!("component compile failed: {e}"))?;
        let mut linker = Linker::<HostState>::new(&engine);
        bindings::ArcadiaPlugin::add_to_linker::<_, HasSelf<_>>(&mut linker, |state| state)
            .map_err(|e| e.to_string())?;
        let limits = StoreLimitsBuilder::new()
            .memory_size(MEMORY_BYTES)
            .instances(1)
            .tables(8)
            .build();
        let app = self
            .app
            .lock()
            .map_err(|_| "plugin runtime lock poisoned")?
            .clone();
        let mut store = Store::new(
            &engine,
            HostState {
                context,
                limits,
                app,
                network_allowlist: manifest.network_allowlist.clone(),
            },
        );
        store.limiter(|state| &mut state.limits);
        Self::prepare(&mut store, &engine)?;
        let guest = bindings::ArcadiaPlugin::instantiate(&mut store, &component, &linker)
            .map_err(|e| format!("component instantiate failed: {e}"))?;
        guest
            .arcadia_plugin_guest()
            .call_initialize(&mut store, "{}")
            .map_err(|e| format!("initialize trapped: {e}"))?
            .map_err(|e| format!("initialize failed: {e}"))?;
        self.instances
            .lock()
            .map_err(|_| "plugin runtime lock poisoned")?
            .insert(
                manifest.id.clone(),
                RunningInstance {
                    engine,
                    store,
                    guest,
                },
            );
        Ok(())
    }
    fn handle_event(
        &self,
        plugin_id: &str,
        kind: &str,
        payload_json: &str,
    ) -> Result<String, String> {
        if payload_json.len() > 1024 * 1024 {
            return Err("event payload exceeds 1 MiB".into());
        }
        let mut instances = self
            .instances
            .lock()
            .map_err(|_| "plugin runtime lock poisoned")?;
        let instance = instances
            .get_mut(plugin_id)
            .ok_or("plugin is not running")?;
        Self::prepare(&mut instance.store, &instance.engine)?;
        let event = bindings::arcadia::plugin::host::Event {
            kind: kind.into(),
            payload_json: payload_json.into(),
        };
        instance
            .guest
            .arcadia_plugin_guest()
            .call_handle_event(&mut instance.store, &event)
            .map_err(|e| format!("event trapped: {e}"))?
            .map_err(|e| format!("event failed: {e}"))
    }
    fn stop(&self, plugin_id: &str) -> Result<(), String> {
        if let Some(mut instance) = self
            .instances
            .lock()
            .map_err(|_| "plugin runtime lock poisoned")?
            .remove(plugin_id)
        {
            Self::prepare(&mut instance.store, &instance.engine)?;
            instance
                .guest
                .arcadia_plugin_guest()
                .call_shutdown(&mut instance.store)
                .map_err(|e| format!("shutdown trapped: {e}"))?;
        }
        Ok(())
    }
}

pub struct DisabledRuntime;
impl PluginRuntime for DisabledRuntime {
    fn start(
        &self,
        _manifest: &PluginManifest,
        _component_path: &Path,
        _context: PluginContext,
    ) -> Result<(), String> {
        Err("plugin runtime is disabled".into())
    }
    fn handle_event(
        &self,
        _plugin_id: &str,
        _kind: &str,
        _payload_json: &str,
    ) -> Result<String, String> {
        Err("plugin runtime is disabled".into())
    }
    fn stop(&self, _plugin_id: &str) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasmtime::{Instance, Module};

    fn manifest() -> PluginManifest {
        PluginManifest {
            schema_version: 1,
            id: "com.arcadia.hello".into(),
            name: "Hello".into(),
            version: "1.0.0".into(),
            description: None,
            author: None,
            component: "plugin.wasm".into(),
            sha256: "0".repeat(64),
            permissions: vec![],
            network_allowlist: vec![],
            events: vec!["test".into()],
            ui_contributions: vec![],
        }
    }

    #[test]
    fn component_lifecycle_round_trip() {
        let path =
            std::env::temp_dir().join(format!("arcadia-plugin-{}.wasm", uuid::Uuid::new_v4()));
        std::fs::write(
            &path,
            include_bytes!("../../samples/hello-plugin/plugin.wasm"),
        )
        .unwrap();
        let runtime = WasmRuntime::default();
        runtime
            .start(
                &manifest(),
                &path,
                PluginContext::new("com.arcadia.hello", []),
            )
            .unwrap();
        assert_eq!(
            runtime
                .handle_event("com.arcadia.hello", "test", r#"{"ok":true}"#)
                .unwrap(),
            r#"handled:test:{"ok":true}"#
        );
        runtime.stop("com.arcadia.hello").unwrap();
        assert!(runtime
            .handle_event("com.arcadia.hello", "test", "{}")
            .is_err());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn fuel_interrupts_infinite_loop() {
        let mut config = Config::new();
        config.consume_fuel(true);
        let engine = Engine::new(&config).unwrap();
        let module = Module::new(
            &engine,
            wat::parse_str("(module (func (export \"run\") (loop br 0)))").unwrap(),
        )
        .unwrap();
        let mut store = Store::new(&engine, ());
        store.set_fuel(10_000).unwrap();
        let instance = Instance::new(&mut store, &module, &[]).unwrap();
        assert!(instance
            .get_typed_func::<(), ()>(&mut store, "run")
            .unwrap()
            .call(&mut store, ())
            .is_err());
        assert_eq!(store.get_fuel().unwrap(), 0);
    }

    #[test]
    fn memory_growth_is_limited() {
        let engine = Engine::default();
        let module=Module::new(&engine,wat::parse_str("(module (memory 1 65536) (func (export \"grow\") (result i32) i32.const 2000 memory.grow))").unwrap()).unwrap();
        let limits = StoreLimitsBuilder::new()
            .memory_size(64 * 1024 * 1024)
            .build();
        struct State(StoreLimits);
        let mut store = Store::new(&engine, State(limits));
        store.limiter(|state| &mut state.0);
        let instance = Instance::new(&mut store, &module, &[]).unwrap();
        assert_eq!(
            instance
                .get_typed_func::<(), i32>(&mut store, "grow")
                .unwrap()
                .call(&mut store, ())
                .unwrap(),
            -1
        );
    }
}
