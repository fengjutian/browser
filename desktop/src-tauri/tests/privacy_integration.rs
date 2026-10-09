//! Integration tests for the privacy URL / third-party logic. The Windows
//! COM attachment code is gated behind `cfg(target_os = "windows")` and
//! isn't reachable from a unit-style test, but we exercise the pure
//! helpers here so the matching / registrable-domain logic is covered.

use ai_knowledge_browser_lib::privacy::platform::{is_third_party, url_origin};

#[test]
fn url_origin_strips_path_query_fragment() {
    assert_eq!(
        url_origin("https://tracker.example.com/p?x=1#y"),
        "https://tracker.example.com"
    );
    assert_eq!(
        url_origin("https://example.com:8443"),
        "https://example.com:8443"
    );
}

#[test]
fn url_origin_handles_malformed_inputs_gracefully() {
    // No scheme: returns the input unchanged.
    assert_eq!(url_origin("not-a-url"), "not-a-url");
    // Empty: returns empty.
    assert_eq!(url_origin(""), "");
}

#[test]
fn third_party_distinguishes_subdomain_from_origin() {
    assert!(is_third_party("https://tracker.example.com", "other.com"));
    assert!(!is_third_party("https://a.example.com", "b.example.com"));
}

#[test]
fn third_party_handles_public_suffix() {
    // `a.b.example.co.uk` vs `example.com` is third-party.
    assert!(is_third_party("https://a.b.example.co.uk", "example.com"));
}

#[test]
fn third_party_treats_ip_literal_as_first_party() {
    assert!(!is_third_party("http://127.0.0.1:8080", "127.0.0.1"));
    assert!(!is_third_party("http://[::1]:8080", "[::1]"));
}

#[test]
fn third_party_handles_localhost() {
    // Bare `localhost` always first-party with itself.
    assert!(!is_third_party("http://localhost:3000", "localhost"));
    // `*.localhost` resolves through the standard suffix list and remains
    // exact-match first-party only when hosts are equal.
    assert!(is_third_party("http://app.localhost", "api.localhost"));
    assert!(!is_third_party("http://app.localhost", "app.localhost"));
}

#[test]
fn third_party_handles_punycode_consistently() {
    // We don't decode punycode, so the literal labels are compared as-is
    // (after lower-casing). Identical labels match (not third-party),
    // distinct labels (even if they decode to the same unicode) are
    // treated as distinct.
    assert!(!is_third_party(
        "https://xn--bcher-kva.example",
        "xn--bcher-kva.example"
    ));
}
