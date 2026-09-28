# Arcadia hello plugin

Build and componentize from `desktop/src-tauri`:

```powershell
cargo build --manifest-path samples/hello-plugin/Cargo.toml --target wasm32-unknown-unknown --release
cargo run --example componentize -- samples/hello-plugin/target/wasm32-unknown-unknown/release/arcadia_hello_plugin.wasm samples/hello-plugin/plugin.wasm
```

The resulting component implements `initialize`, echoes `handle-event`, and accepts `shutdown`.
