pub mod openai;
pub mod ollama;

use serde::{Deserialize, Serialize};

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
}

impl From<reqwest::Error> for ProviderError {
    fn from(value: reqwest::Error) -> Self { ProviderError::Http(value.to_string()) }
}

#[async_trait::async_trait]
pub trait AiProvider: Send + Sync {
    fn type_id(&self) -> &'static str;
    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse, ProviderError>;
}
