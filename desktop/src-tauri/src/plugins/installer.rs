use super::PluginManifest;
use rusqlite::params;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Write}, path::{Path, PathBuf}};
use tauri::Manager;

const MAX_ARCHIVE: u64 = 20 * 1024 * 1024;
const MAX_EXPANDED: u64 = 50 * 1024 * 1024;
const MAX_FILES: usize = 256;

#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct InstalledPlugin { pub id:String,pub name:String,pub version:String,pub status:String,pub enabled:bool,pub last_error:Option<String>,pub manifest:PluginManifest }

fn plugin_root(app:&tauri::AppHandle)->Result<PathBuf,String>{let root=app.path().app_data_dir().map_err(|e|e.to_string())?.join("plugins");fs::create_dir_all(&root).map_err(|e|e.to_string())?;Ok(root)}

#[tauri::command]
pub fn install_plugin(app:tauri::AppHandle,archive_path:String)->Result<InstalledPlugin,String>{
    let source=Path::new(&archive_path);
    let meta=fs::metadata(source).map_err(|e|e.to_string())?;
    if !meta.is_file()||meta.len()>MAX_ARCHIVE{return Err("plugin archive exceeds 20 MiB or is not a file".into())}
    let file=fs::File::open(source).map_err(|e|e.to_string())?;
    let mut archive=zip::ZipArchive::new(file).map_err(|e|e.to_string())?;
    if archive.len()>MAX_FILES{return Err("plugin archive contains too many files".into())}
    let mut manifest_bytes=Vec::new();archive.by_name("plugin.json").map_err(|_|"plugin.json is missing")?.take(1024*1024).read_to_end(&mut manifest_bytes).map_err(|e|e.to_string())?;
    let manifest:PluginManifest=serde_json::from_slice(&manifest_bytes).map_err(|e|format!("invalid plugin manifest: {e}"))?;manifest.validate().map_err(str::to_string)?;
    let root=plugin_root(&app)?;let staging=root.join(format!(".staging-{}",uuid::Uuid::new_v4()));fs::create_dir(&staging).map_err(|e|e.to_string())?;
    let result=(||->Result<(),String>{let mut expanded=0u64;for index in 0..archive.len(){let mut item=archive.by_index(index).map_err(|e|e.to_string())?;if item.is_dir(){continue}let enclosed=item.enclosed_name().ok_or("unsafe path in plugin archive")?.to_path_buf();expanded=expanded.saturating_add(item.size());if expanded>MAX_EXPANDED{return Err("expanded plugin exceeds 50 MiB".into())}let target=staging.join(enclosed);if let Some(parent)=target.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?}let mut out=fs::File::create(target).map_err(|e|e.to_string())?;std::io::copy(&mut item,&mut out).map_err(|e|e.to_string())?;out.flush().map_err(|e|e.to_string())?}let component=fs::read(staging.join("plugin.wasm")).map_err(|_|"plugin.wasm is missing")?;let digest=format!("{:x}",Sha256::digest(&component));if !digest.eq_ignore_ascii_case(&manifest.sha256){return Err("plugin.wasm sha256 mismatch".into())}let mut config=wasmtime::Config::new();config.wasm_component_model(true).consume_fuel(true).epoch_interruption(true);let engine=wasmtime::Engine::new(&config).map_err(|e|e.to_string())?;wasmtime::component::Component::from_binary(&engine,&component).map_err(|e|format!("invalid WebAssembly component: {e}"))?;Ok(())})();
    if let Err(error)=result{let _=fs::remove_dir_all(&staging);return Err(error)}
    let target=root.join(&manifest.id).join(&manifest.version);fs::create_dir_all(target.parent().unwrap()).map_err(|e|e.to_string())?;if target.exists(){let _=fs::remove_dir_all(&staging);return Err("plugin version is already installed".into())}fs::rename(&staging,&target).map_err(|e|e.to_string())?;
    let now=chrono::Utc::now().timestamp();let json=serde_json::to_string(&manifest).map_err(|e|e.to_string())?;let db=crate::local_store::connection(&app)?;db.execute("INSERT INTO plugins(id,name,version,manifest_json,component_path,sha256,status,enabled,installed_at,updated_at) VALUES(?,?,?,?,?,?,'DISABLED',0,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=excluded.version,manifest_json=excluded.manifest_json,component_path=excluded.component_path,sha256=excluded.sha256,status='DISABLED',enabled=0,last_error=NULL,updated_at=excluded.updated_at",params![manifest.id,manifest.name,manifest.version,json,target.join("plugin.wasm").to_string_lossy(),manifest.sha256,now,now]).map_err(|e|e.to_string())?;
    read_plugin(&db,&manifest.id)
}

fn read_plugin(db:&rusqlite::Connection,id:&str)->Result<InstalledPlugin,String>{db.query_row("SELECT id,name,version,status,enabled,last_error,manifest_json FROM plugins WHERE id=?",[id],|r|{let raw:String=r.get(6)?;let manifest=serde_json::from_str(&raw).map_err(|e|rusqlite::Error::FromSqlConversionFailure(6,rusqlite::types::Type::Text,Box::new(e)))?;Ok(InstalledPlugin{id:r.get(0)?,name:r.get(1)?,version:r.get(2)?,status:r.get(3)?,enabled:r.get::<_,i64>(4)?!=0,last_error:r.get(5)?,manifest})}).map_err(|e|e.to_string())}

#[tauri::command] pub fn list_plugins(app:tauri::AppHandle)->Result<Vec<InstalledPlugin>,String>{let db=crate::local_store::connection(&app)?;let mut stmt=db.prepare("SELECT id FROM plugins ORDER BY name").map_err(|e|e.to_string())?;let ids=stmt.query_map([],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;ids.iter().map(|id|read_plugin(&db,id)).collect()}
#[tauri::command] pub fn set_plugin_enabled(app:tauri::AppHandle,id:String,enabled:bool)->Result<(),String>{let db=crate::local_store::connection(&app)?;let changed=db.execute("UPDATE plugins SET enabled=?,status=?,updated_at=? WHERE id=?",params![enabled as i64,if enabled{"ENABLED"}else{"DISABLED"},chrono::Utc::now().timestamp(),id]).map_err(|e|e.to_string())?;if changed==0{return Err("plugin not found".into())}Ok(())}
#[tauri::command] pub fn uninstall_plugin(app:tauri::AppHandle,id:String)->Result<(),String>{let db=crate::local_store::connection(&app)?;let path:String=db.query_row("SELECT component_path FROM plugins WHERE id=?",[&id],|r|r.get(0)).map_err(|_|"plugin not found")?;db.execute("DELETE FROM plugins WHERE id=?",[&id]).map_err(|e|e.to_string())?;if let Some(version)=Path::new(&path).parent(){let _=fs::remove_dir_all(version)}Ok(())}
