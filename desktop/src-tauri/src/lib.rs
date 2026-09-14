pub mod browser;
pub mod plugins;

#[tauri::command]
fn validate_navigation(url: String) -> Result<String, String> {
    browser::normalize_navigation(&url).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![validate_navigation])
        .run(tauri::generate_context!())
        .expect("error while running AI Knowledge Browser");
}
