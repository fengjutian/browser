use url::Url;

pub fn normalize_navigation(input: &str) -> Result<String, url::ParseError> {
    let trimmed = input.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Url::parse(trimmed).map(|url| url.to_string());
    }
    if trimmed.contains('.') && !trimmed.contains(' ') {
        return Url::parse(&format!("https://{trimmed}")).map(|url| url.to_string());
    }
    Url::parse_with_params("https://www.google.com/search", &[("q", trimmed)])
        .map(|url| url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn adds_https_to_domains() { assert_eq!(normalize_navigation("example.com").unwrap(), "https://example.com/"); }
    #[test]
    fn turns_words_into_search() { assert!(normalize_navigation("tauri browser").unwrap().contains("q=tauri+browser")); }
}
