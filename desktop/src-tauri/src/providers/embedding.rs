//! Embedding provider (batch 1 + batch 5 integration).
//!
//! Shared between the Tauri command `ai_embed` and the RAG retrieval
//! pipeline so query and document embeddings come from the same wire code
//! path. The functions in this module are the single source of truth for
//! "talk to Ollama or an OpenAI-compatible /embeddings endpoint, get back
//! vectors". They:
//!
//! 1. Read provider row (type / base_url / embedding_model / timeout).
//! 2. Pull the API key from the OS keyring for non-Ollama providers.
//! 3. Send a real HTTP request with the right body shape.
//! 4. Verify status, vector count, dimensions, NaN/Inf.
//! 5. Return an [`EmbeddingResponse`] the caller can use directly.
//!
//! Logging deliberately redacts API keys and request bodies.

use std::time::Duration;

use reqwest::Client;
use rusqlite::{params, Connection, OptionalExtension};

use super::ProviderError;

const MAX_RESPONSE_BYTES: usize = 50 * 1024 * 1024;
const MAX_INPUT_BYTES: usize = 32_000;

#[derive(Debug, Clone)]
pub struct EmbeddingRequest {
    pub provider_id: String,
    pub provider_type: String,
    pub base_url: String,
    pub model: String,
    pub inputs: Vec<String>,
    pub timeout_seconds: i64,
}

#[derive(Debug, Clone)]
pub struct EmbeddingResponse {
    pub vectors: Vec<Vec<f32>>,
    pub model: String,
    pub dimensions: usize,
}

/// Read the embedding-model row for a provider. Returns `None` if the
/// provider doesn't exist or has no embedding_model configured.
pub fn read_provider_row(
    database: &Connection,
    provider_id: &str,
) -> Result<Option<EmbeddingRequest>, String> {
    let row = database
        .query_row(
            "SELECT provider_type, base_url, embedding_model, timeout_seconds FROM ai_providers WHERE id=?1",
            params![provider_id],
            |row| {
                let provider_type: String = row.get(0)?;
                let base_url: String = row.get(1)?;
                let model: Option<String> = row.get(2)?;
                let timeout_seconds: i64 = row.get(3)?;
                Ok((provider_type, base_url, model, timeout_seconds))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((provider_type, base_url, model, timeout_seconds)) = row else {
        return Ok(None);
    };
    let Some(model) = model.filter(|value| !value.trim().is_empty()) else {
        return Ok(None);
    };
    Ok(Some(EmbeddingRequest {
        provider_id: provider_id.to_string(),
        provider_type,
        base_url,
        model,
        inputs: Vec::new(),
        timeout_seconds,
    }))
}

/// Validate inputs and dispatch to the right provider endpoint.
pub async fn embed_with_provider(
    req: EmbeddingRequest,
) -> Result<EmbeddingResponse, ProviderError> {
    if req.inputs.is_empty() || req.inputs.len() > 64 {
        return Err(ProviderError::InvalidResponse(
            "embedding input count must be 1..64".into(),
        ));
    }
    if req.inputs.iter().any(|value| value.len() > MAX_INPUT_BYTES) {
        return Err(ProviderError::InvalidResponse(
            "embedding input is too large".into(),
        ));
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(req.timeout_seconds.clamp(1, 600) as u64))
        .build()
        .map_err(|e| ProviderError::Http(e.to_string()))?;

    let (endpoint, body, needs_auth) = if req.provider_type == "ollama" {
        (
            format!("{}/api/embed", req.base_url.trim_end_matches('/')),
            serde_json::json!({"model": req.model, "input": req.inputs}),
            false,
        )
    } else {
        (
            format!("{}/embeddings", req.base_url.trim_end_matches('/')),
            serde_json::json!({"model": req.model, "input": req.inputs}),
            true,
        )
    };

    let mut builder = client.post(&endpoint).json(&body);
    if needs_auth {
        let key = keyring::Entry::new(crate::KEYRING_SERVICE, &req.provider_id)
            .map_err(|e| ProviderError::Http(format!("keyring open: {e}")))?
            .get_password()
            .map_err(|_| ProviderError::MissingApiKey)?;
        if key.is_empty() {
            return Err(ProviderError::MissingApiKey);
        }
        builder = builder.bearer_auth(key);
    }

    let response = builder.send().await?;
    let status = response.status();
    // Read with a hard byte cap to defend against provider responses that
    // try to exhaust process memory.
    let mut limited = response.bytes_stream();
    let mut total: usize = 0;
    let mut buf: Vec<u8> = Vec::new();
    use futures_util::StreamExt;
    while let Some(item) = limited.next().await {
        let chunk = item.map_err(|e| ProviderError::Http(format!("stream: {e}")))?;
        total = total.saturating_add(chunk.len());
        if total > MAX_RESPONSE_BYTES {
            return Err(ProviderError::InvalidResponse(format!(
                "response exceeded {MAX_RESPONSE_BYTES} bytes"
            )));
        }
        buf.extend_from_slice(&chunk);
    }
    let mut value: serde_json::Value = serde_json::from_slice(&buf)
        .map_err(|e| ProviderError::Http(format!("body parse: {e}")))?;
    if !status.is_success() {
        let body_preview = if let Some(obj) = value.as_object_mut() {
            obj.remove("data");
            obj.remove("embedding");
            obj.remove("embeddings");
            serde_json::Value::Object(obj.clone()).to_string()
        } else {
            String::new()
        };
        let body_preview: String = body_preview.chars().take(400).collect();
        return Err(ProviderError::ProviderStatus {
            status: status.as_u16(),
            body: body_preview,
        });
    }

    let raw_vectors: Vec<Vec<f32>> = if req.provider_type == "ollama" {
        serde_json::from_value(
            value
                .get("embeddings")
                .cloned()
                .ok_or_else(|| ProviderError::InvalidResponse("missing embeddings".into()))?,
        )
        .map_err(|e| ProviderError::InvalidResponse(format!("ollama embeddings parse: {e}")))?
    } else {
        let arr = value
            .get("data")
            .and_then(|v| v.as_array())
            .ok_or_else(|| ProviderError::InvalidResponse("missing data array".into()))?;
        let mut out = Vec::with_capacity(arr.len());
        for (idx, item) in arr.iter().enumerate() {
            let vec: Vec<f32> =
                serde_json::from_value(item.get("embedding").cloned().ok_or_else(|| {
                    ProviderError::InvalidResponse(format!("missing embedding[{idx}]"))
                })?)
                .map_err(|e| {
                    ProviderError::InvalidResponse(format!("embedding[{idx}] parse: {e}"))
                })?;
            out.push(vec);
        }
        out
    };

    if raw_vectors.len() != req.inputs.len() {
        return Err(ProviderError::InvalidResponse(format!(
            "embedding provider returned {} vectors for {} inputs",
            raw_vectors.len(),
            req.inputs.len()
        )));
    }
    let mut dimensions = 0usize;
    for (idx, vec) in raw_vectors.iter().enumerate() {
        if vec.is_empty() {
            return Err(ProviderError::InvalidResponse(format!(
                "empty vector at index {idx}"
            )));
        }
        if dimensions == 0 {
            dimensions = vec.len();
        } else if vec.len() != dimensions {
            return Err(ProviderError::InvalidResponse(format!(
                "vector dimension mismatch: {dimensions} vs {}",
                vec.len()
            )));
        }
        for value in vec {
            if !value.is_finite() {
                return Err(ProviderError::InvalidResponse(format!(
                    "non-finite value at index {idx}"
                )));
            }
        }
    }

    Ok(EmbeddingResponse {
        vectors: raw_vectors,
        model: req.model,
        dimensions,
    })
}

/// Look up the provider row and call [`embed_with_provider`] in one step.
/// Read the provider config (sync) and return a ready-to-use
/// `EmbeddingRequest`. Errors are surfaced as `ProviderError::Http` so
/// callers can use a single error type.
pub fn read_embedding_request(
    database: &Connection,
    provider_id: &str,
) -> Result<EmbeddingRequest, ProviderError> {
    read_provider_row(database, provider_id)
        .map_err(ProviderError::Http)?
        .ok_or_else(|| {
            ProviderError::InvalidResponse(format!(
                "provider {provider_id} not found or no embedding model configured"
            ))
        })
}

/// Async entry point used by callers that already loaded the
/// [`EmbeddingRequest`]. Use [`embed_for_provider`] for the
/// read-and-embed one-step API.
pub async fn embed_with_request(req: EmbeddingRequest) -> Result<EmbeddingResponse, ProviderError> {
    embed_with_provider(req).await
}

/// Convenience: look up the provider row and call [`embed_with_provider`].
/// Synchronously reads the row, then runs the embed; the database borrow
/// is dropped before any `.await` so the future is `Send`.
pub async fn embed_for_provider(
    database: &Connection,
    provider_id: &str,
    inputs: Vec<String>,
) -> Result<EmbeddingResponse, ProviderError> {
    let mut req = read_embedding_request(database, provider_id)?;
    req.inputs = inputs;
    embed_with_provider(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_provider_row_returns_none_when_missing_embedding_model() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE ai_providers(
                id TEXT PRIMARY KEY, provider_type TEXT NOT NULL, base_url TEXT NOT NULL,
                embedding_model TEXT, timeout_seconds INTEGER NOT NULL DEFAULT 60
             );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO ai_providers(id, provider_type, base_url, embedding_model, timeout_seconds)
             VALUES('p','ollama','http://x',NULL,60)",
            [],
        )
        .unwrap();
        let row = read_provider_row(&conn, "p").unwrap();
        assert!(row.is_none());
    }

    #[test]
    fn read_provider_row_returns_request_when_set() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE ai_providers(
                id TEXT PRIMARY KEY, provider_type TEXT NOT NULL, base_url TEXT NOT NULL,
                embedding_model TEXT, timeout_seconds INTEGER NOT NULL DEFAULT 60
             );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO ai_providers(id, provider_type, base_url, embedding_model, timeout_seconds)
             VALUES('p','openai-compatible','http://x','text-embedding-3-small',120)",
            [],
        )
        .unwrap();
        let row = read_provider_row(&conn, "p").unwrap().unwrap();
        assert_eq!(row.model, "text-embedding-3-small");
        assert_eq!(row.timeout_seconds, 120);
    }
}
