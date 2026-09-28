wit_bindgen::generate!({ path: "../../wit", world: "arcadia-plugin" });

struct HelloPlugin;

impl exports::arcadia::plugin::guest::Guest for HelloPlugin {
    fn initialize(_config_json: String) -> Result<(), String> { Ok(()) }

    fn handle_event(event: arcadia::plugin::host::Event) -> Result<String, String> {
        Ok(format!("handled:{}:{}", event.kind, event.payload_json))
    }

    fn shutdown() {}
}

export!(HelloPlugin);
