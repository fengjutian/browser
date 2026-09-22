use super::{AiProvider, ChatMessage, ChatRequest, ChatResponse, ProviderError};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub struct OpenAICompatibleProvider {
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
    pub timeout: Duration,
}

#[derive(Debug, Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    stream: bool,
}

#[derive(Debug, Serialize)]
struct OpenAIMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct OpenAIResponse {
    choices: Vec<OpenAIChoice>,
    #[serde(default)]
    usage: Option<OpenAIUsage>,
}

#[derive(Debug, Deserialize)]
struct OpenAIChoice {
    #[serde(default)]
    message: Option<OpenAIResponseMessage>,
}

#[derive(Debug, Deserialize)]
struct OpenAIResponseMessage {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAIUsage {
    #[serde(default)]
    prompt_tokens: Option<u64>,
    #[serde(default)]
    completion_tokens: Option<u64>,
}

#[async_trait]
impl AiProvider for OpenAICompatibleProvider {
    fn type_id(&self) -> &'static str { "openai-compatible" }

    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse, ProviderError> {
        let client = reqwest::Client::builder()
            .timeout(self.timeout)
            .build()?;
        let messages: Vec<OpenAIMessage> = request.messages.into_iter().map(message_to_wire).collect();
        let body = OpenAIRequest {
            model: self.model.clone(),
            messages,
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            stream: false,
        };
        let url = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));
        let mut request_builder = client.post(url).json(&body);
        if let Some(key) = self.api_key.as_deref() {
            if !key.is_empty() {
                request_builder = request_builder.bearer_auth(key);
            }
        }
        let response = request_builder.send().await?;
        let status = response.status();
        let text = response.text().await?;
        if !status.is_success() {
            return Err(ProviderError::ProviderStatus { status: status.as_u16(), body: sanitize_body(&text) });
        }
        let parsed: OpenAIResponse = serde_json::from_str(&text).map_err(|error| ProviderError::InvalidResponse(format!("{error}: {}", sanitize_body(&text))))?;
        let content = parsed
            .choices
            .into_iter()
            .filter_map(|choice| choice.message.and_then(|message| message.content))
            .collect::<Vec<_>>()
            .join("")
            .trim()
            .to_string();
        if content.is_empty() {
            return Err(ProviderError::InvalidResponse("empty assistant content".into()));
        }
        Ok(ChatResponse {
            content,
            prompt_tokens: parsed.usage.as_ref().and_then(|u| u.prompt_tokens),
            completion_tokens: parsed.usage.as_ref().and_then(|u| u.completion_tokens),
        })
    }
}

fn message_to_wire(message: ChatMessage) -> OpenAIMessage {
    OpenAIMessage { role: message.role, content: message.content }
}

fn sanitize_body(body: &str) -> String {
    // Strip provider error bodies of any accidental api key echo before logging
    let lower = body.to_ascii_lowercase();
    if lower.contains("api_key") || lower.contains("authorization") || lower.contains("bearer ") {
        let truncated: String = body.chars().take(400).collect();
        format!("{truncated}…[truncated]")
    } else {
        body.chars().take(400).collect()
    }
}
