fn main() {
    // The application artwork is configured in tauri.conf.json. Generating a
    // placeholder here would overwrite the title-bar and taskbar icon on every build.
    tauri_build::build();
}
