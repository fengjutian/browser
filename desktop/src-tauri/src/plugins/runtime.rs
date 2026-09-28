use super::{PluginContext, PluginManifest, PluginPermission};
use std::{collections::HashMap, path::Path, sync::Mutex, time::Duration};
use wasmtime::{component::{Component, Linker}, Config, Engine, Store, StoreLimits, StoreLimitsBuilder};

mod bindings { wasmtime::component::bindgen!({ path: "wit", world: "arcadia-plugin", async: false }); }

const FUEL: u64 = 10_000_000;
const MEMORY_BYTES: usize = 64 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(5);

struct HostState { context: PluginContext, limits: StoreLimits }

impl bindings::arcadia::plugin::host::Host for HostState {
    fn log(&mut self, level:String, message:String)->wasmtime::Result<Result<(),String>> { if message.len()>16*1024{return Ok(Err("log message exceeds 16 KiB".into()))}eprintln!("plugin[{}] {level}: {message}",self.context.plugin_id());Ok(Ok(())) }
    fn knowledge_search(&mut self,_query:String,_limit:u32)->wasmtime::Result<Result<String,String>> { Ok(self.context.require(PluginPermission::KnowledgeRead).map(|_|"[]".into())) }
    fn knowledge_get(&mut self,_id:String)->wasmtime::Result<Result<String,String>> { Ok(self.context.require(PluginPermission::KnowledgeRead).map(|_|"null".into())) }
    fn ai_chat(&mut self,_request_json:String)->wasmtime::Result<Result<String,String>> { Ok(self.context.require(PluginPermission::AiChat).map(|_|"{}".into())) }
    fn http_fetch(&mut self,_request_json:String)->wasmtime::Result<Result<String,String>> { Ok(self.context.require(PluginPermission::NetworkRequest).map(|_|"{}".into())) }
}

pub trait PluginRuntime: Send+Sync {
    fn start(&self,manifest:&PluginManifest,component_path:&Path,context:PluginContext)->Result<(),String>;
    fn handle_event(&self,plugin_id:&str,kind:&str,payload_json:&str)->Result<String,String>;
    fn stop(&self,plugin_id:&str)->Result<(),String>;
}

struct RunningInstance { engine:Engine, store:Store<HostState>, guest:bindings::ArcadiaPlugin }
pub struct WasmRuntime { instances:Mutex<HashMap<String,RunningInstance>> }
impl Default for WasmRuntime { fn default()->Self{Self{instances:Mutex::new(HashMap::new())}} }

impl WasmRuntime {
    fn engine()->Result<Engine,String>{let mut config=Config::new();config.wasm_component_model(true).consume_fuel(true).epoch_interruption(true);Engine::new(&config).map_err(|e|e.to_string())}
    fn arm_timeout(engine:Engine){std::thread::spawn(move||{std::thread::sleep(TIMEOUT);engine.increment_epoch();});}
    fn prepare(store:&mut Store<HostState>,engine:&Engine)->Result<(),String>{store.set_fuel(FUEL).map_err(|e|e.to_string())?;store.set_epoch_deadline(1);Self::arm_timeout(engine.clone());Ok(())}
}

impl PluginRuntime for WasmRuntime {
    fn start(&self,manifest:&PluginManifest,component_path:&Path,context:PluginContext)->Result<(),String>{
        manifest.validate().map_err(str::to_string)?;let engine=Self::engine()?;let component=Component::from_file(&engine,component_path).map_err(|e|format!("component compile failed: {e}"))?;
        let mut linker=Linker::<HostState>::new(&engine);bindings::ArcadiaPlugin::add_to_linker(&mut linker,|state|state).map_err(|e|e.to_string())?;
        let limits=StoreLimitsBuilder::new().memory_size(MEMORY_BYTES).instances(1).tables(8).build();let mut store=Store::new(&engine,HostState{context,limits});store.limiter(|state|&mut state.limits);Self::prepare(&mut store,&engine)?;
        let (guest,_)=bindings::ArcadiaPlugin::instantiate(&mut store,&component,&linker).map_err(|e|format!("component instantiate failed: {e}"))?;
        guest.arcadia_plugin_guest().call_initialize(&mut store,"{}").map_err(|e|format!("initialize trapped: {e}"))?.map_err(|e|format!("initialize failed: {e}"))?;
        self.instances.lock().map_err(|_|"plugin runtime lock poisoned")?.insert(manifest.id.clone(),RunningInstance{engine,store,guest});Ok(())
    }
    fn handle_event(&self,plugin_id:&str,kind:&str,payload_json:&str)->Result<String,String>{
        if payload_json.len()>1024*1024{return Err("event payload exceeds 1 MiB".into())}let mut instances=self.instances.lock().map_err(|_|"plugin runtime lock poisoned")?;let instance=instances.get_mut(plugin_id).ok_or("plugin is not running")?;Self::prepare(&mut instance.store,&instance.engine)?;
        let event=bindings::arcadia::plugin::host::Event{kind:kind.into(),payload_json:payload_json.into()};instance.guest.arcadia_plugin_guest().call_handle_event(&mut instance.store,&event).map_err(|e|format!("event trapped: {e}"))?.map_err(|e|format!("event failed: {e}"))
    }
    fn stop(&self,plugin_id:&str)->Result<(),String>{if let Some(mut instance)=self.instances.lock().map_err(|_|"plugin runtime lock poisoned")?.remove(plugin_id){Self::prepare(&mut instance.store,&instance.engine)?;instance.guest.arcadia_plugin_guest().call_shutdown(&mut instance.store).map_err(|e|format!("shutdown trapped: {e}"))?;}Ok(())}
}

pub struct DisabledRuntime;
impl PluginRuntime for DisabledRuntime {
    fn start(&self,_manifest:&PluginManifest,_component_path:&Path,_context:PluginContext)->Result<(),String>{Err("plugin runtime is disabled".into())}
    fn handle_event(&self,_plugin_id:&str,_kind:&str,_payload_json:&str)->Result<String,String>{Err("plugin runtime is disabled".into())}
    fn stop(&self,_plugin_id:&str)->Result<(),String>{Ok(())}
}
