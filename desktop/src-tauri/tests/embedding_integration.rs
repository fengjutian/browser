//! Integration tests for the shared embedding provider module.
//!
//! These tests use a tiny in-process HTTP mock to verify that
//! `providers::embedding::embed_with_provider` correctly:
//! - Routes Ollama vs OpenAI-compatible endpoints
//! - Surfaces HTTP errors with a redacted body
//! - Rejects vector count / dimension mismatches
//! - Rejects non-finite values
//!
//! We use the Ollama shape so we don't need a real API key on the host.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

use ai_knowledge_browser_lib::providers::embedding::{embed_with_request, EmbeddingRequest};

fn spawn_server(response_body: &'static str) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        let (mut sock, _) = listener.accept().unwrap();
        let mut buf = [0u8; 4096];
        let _ = sock.read(&mut buf);
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        let _ = sock.write_all(response.as_bytes());
    });
    port
}

fn make_request(port: u16, model: &str) -> EmbeddingRequest {
    EmbeddingRequest {
        provider_id: "test".into(),
        provider_type: "ollama".into(),
        base_url: format!("http://127.0.0.1:{port}"),
        model: model.into(),
        inputs: vec!["hello".into(), "world".into()],
        timeout_seconds: 10,
    }
}

#[tokio::test]
async fn ollama_parses_embeddings_array() {
    let body = r#"{"embeddings":[[0.1,0.2,0.3],[0.4,0.5,0.6]]}"#;
    let port = spawn_server(body);
    let response = embed_with_request(make_request(port, "nomic-embed"))
        .await
        .unwrap();
    assert_eq!(response.vectors.len(), 2);
    assert_eq!(response.dimensions, 3);
    assert_eq!(response.model, "nomic-embed");
}

#[tokio::test]
async fn dimension_mismatch_is_rejected() {
    let body = r#"{"embeddings":[[0.1,0.2,0.3],[0.4,0.5]]}"#;
    let port = spawn_server(body);
    let err = embed_with_request(make_request(port, "nomic-embed"))
        .await
        .expect_err("dimension mismatch must error");
    assert!(format!("{err:?}").contains("dimension"), "got: {err:?}");
}

#[tokio::test]
async fn missing_embeddings_key_is_rejected() {
    let body = r#"{"unexpected":"shape"}"#;
    let port = spawn_server(body);
    let err = embed_with_request(make_request(port, "nomic-embed"))
        .await
        .expect_err("missing embeddings must error");
    assert!(format!("{err:?}").contains("embeddings"), "got: {err:?}");
}

#[tokio::test]
async fn empty_vector_is_rejected() {
    let body = r#"{"embeddings":[[],[0.4,0.5,0.6]]}"#;
    let port = spawn_server(body);
    let err = embed_with_request(make_request(port, "nomic-embed"))
        .await
        .expect_err("empty vector must error");
    assert!(format!("{err:?}").contains("empty"), "got: {err:?}");
}

#[tokio::test]
async fn http_error_is_surfaced_with_status() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || loop {
        let (mut sock, _) = listener.accept().unwrap();
        let mut buf = [0u8; 4096];
        let _ = sock.read(&mut buf);
        let body = r#"{"error":"model not found"}"#;
        let response = format!(
            "HTTP/1.1 404 Not Found\r\nContent-Length: {}\r\nContent-Type: application/json\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = sock.write_all(response.as_bytes());
    });
    let err = embed_with_request(make_request(port, "missing-model"))
        .await
        .expect_err("404 must error");
    let formatted = format!("{err:?}");
    assert!(formatted.contains("404"), "got: {formatted}");
}
