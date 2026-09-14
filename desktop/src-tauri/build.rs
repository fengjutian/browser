fn main() {
    let icon_dir =
        std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir"))
            .join("icons");
    std::fs::create_dir_all(&icon_dir).expect("create icon directory");
    #[cfg(target_os = "windows")]
    {
        let icon = icon_dir.join("icon.ico");
        // Minimal 1x1 32-bit ICO used for development builds; release artwork replaces it at packaging time.
        let bytes: [u8; 70] = [
            0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 32, 0, 48, 0, 0, 0, 22, 0, 0, 0, 40, 0, 0, 0, 1, 0,
            0, 0, 2, 0, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 51, 120, 81, 255, 0, 0, 0, 0,
        ];
        std::fs::write(&icon, bytes).expect("write development icon");
        let windows = tauri_build::WindowsAttributes::new().window_icon_path(icon);
        tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
            .expect("tauri build");
    }
    #[cfg(not(target_os = "windows"))]
    tauri_build::build();
}
