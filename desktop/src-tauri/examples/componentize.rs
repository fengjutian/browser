use std::{env, fs};
use wit_component::ComponentEncoder;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let input = args.next().ok_or("usage: componentize <core.wasm> <component.wasm>")?;
    let output = args.next().ok_or("usage: componentize <core.wasm> <component.wasm>")?;
    let module = fs::read(input)?;
    let component = ComponentEncoder::default().module(&module)?.validate(true).encode()?;
    fs::write(output, component)?;
    Ok(())
}
