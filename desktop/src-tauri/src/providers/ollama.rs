use super::{AiProvider, ChatMessage, ChatRequest, ChatResponse, ProviderError};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub struct OllamaProvider {
    pub base_url: String,
    pub model: String,
    pub timeout: Duration,
}

#[derive(Debug, Serialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
}

#[derive(Debug, Serialize)]
struct OllamaMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct OllamaResponse {
    #[serde(default)]
    message: Option<OllamaResponseMessage>,
}

#[derive(Debug, Deserialize)]
struct OllamaResponseMessage {
    #[serde(default)]
    content: Option<String>,
}

#[async_trait]
impl AiProvider for OllamaProvider {
    fn type_id(&self) -> &'static str { "ollama" }

    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse, ProviderError> {
        let client = reqwest::Client::builder()
            .timeout(self.timeout)
            .build()?;
        let messages: Vec<OllamaMessage> = request.messages.into_iter().map(message_to_wire).collect();
        let body = OllamaRequest { model: self.model.clone(), messages, stream: false };
        let url = format!("{}/api/chat", self.base_url.trim_end_matches('/'));
        let response = client.post(url).json(&body).send().await?;
        let status = response.status();
        let text = response.text().await?;
        if !status.is_success() {
            return Err(ProviderError::ProviderStatus { status: status.as_u16(), body: sanitize_body(&text) });
        }
        let parsed: OllamaResponse = serde_json::from_str(&text).map_err(|error| ProviderError::InvalidResponse(format!("{error}: {}", sanitize_body(&text))))?;
        let content = parsed.message.and_then(|message| message.content).unwrap_or_default();
        if content.is_empty() {
            return Err(ProviderError::InvalidResponse("empty assistant content".into()));
        }
        Ok(ChatResponse { content, prompt_tokens: None, completion_tokens: None })
    }
}

fn message_to_wire(message: ChatMessage) -> OllamaMessage {
    OllamaMessage { role: message.role, content: message.content }
}

fn sanitize_body(body: &str) -> String {
    body.chars().take(400).collect()
}
