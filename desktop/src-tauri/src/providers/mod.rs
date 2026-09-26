pub mod openai;
pub mod ollama;

use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
}

/// One delta emitted by a streaming provider. `delta` is the incremental text
/// since the previous chunk (may be empty for finish markers). `done` is true
/// only on the terminal chunk; `finish_reason` is populated on that final
/// chunk and reflects the provider-side reason (`stop`, `length`, …).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatChunk {
    pub delta: String,
    #[serde(default)]
    pub finish_reason: Option<String>,
    pub done: bool,
    #[serde(default)]
    pub prompt_tokens: Option<u64>,
    #[serde(default)]
    pub completion_tokens: Option<u64>,
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("missing api key for this provider")]
    MissingApiKey,
    #[error("http error: {0}")]
    Http(String),
    #[error("invalid response: {0}")]
    InvalidResponse(String),
    #[error("provider error: {status} {body}")]
    ProviderStatus { status: u16, body: String },
    #[error("stream cancelled")]
    Cancelled,
}

impl From<reqwest::Error> for ProviderError {
    fn from(value: reqwest::Error) -> Self { ProviderError::Http(value.to_string()) }
}

#[async_trait::async_trait]
pub trait AiProvider: Send + Sync {
    fn type_id(&self) -> &'static str;
    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse, ProviderError>;

    /// Stream chat completion deltas into `sink`. Returning `Ok(())` means the
    /// provider finished cleanly; returning `Err` means the stream aborted.
    /// Implementations must close the channel before returning.
    async fn chat_stream(
        &self,
        request: ChatRequest,
        sink: mpsc::Sender<ChatChunk>,
        cancel: tokio_util::sync::CancellationToken,
    ) -> Result<(), ProviderError>;
}

pub mod cancel {
    use tokio_util::sync::CancellationToken;
    pub fn new() -> CancellationToken { CancellationToken::new() }
}
