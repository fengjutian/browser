use super::{AiProvider, ChatChunk, ChatMessage, ChatRequest, ChatResponse, ProviderError};
use async_trait::async_trait;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

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
    #[serde(skip_serializing_if = "Option::is_none")]
    stream_options: Option<StreamOptions>,
}

#[derive(Debug, Serialize)]
struct StreamOptions {
    include_usage: bool,
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
struct OpenAIStreamChunk {
    #[serde(default)]
    choices: Vec<OpenAIStreamChoice>,
    #[serde(default)]
    usage: Option<OpenAIUsage>,
}

#[derive(Debug, Deserialize)]
struct OpenAIStreamChoice {
    #[serde(default)]
    delta: Option<OpenAIStreamDelta>,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct OpenAIStreamDelta {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
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
            stream_options: None,
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

    async fn chat_stream(
        &self,
        request: ChatRequest,
        sink: mpsc::Sender<ChatChunk>,
        cancel: CancellationToken,
    ) -> Result<(), ProviderError> {
        let client = reqwest::Client::builder()
            .timeout(self.timeout)
            .build()?;
        let messages: Vec<OpenAIMessage> = request.messages.into_iter().map(message_to_wire).collect();
        let body = OpenAIRequest {
            model: self.model.clone(),
            messages,
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            stream: true,
            stream_options: Some(StreamOptions { include_usage: true }),
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
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(ProviderError::ProviderStatus { status: status.as_u16(), body: sanitize_body(&body) });
        }
        let mut byte_stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut emitted_done = false;
        let mut last_usage: Option<OpenAIUsage> = None;

        loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => {
                    return Err(ProviderError::Cancelled);
                }
                next = byte_stream.next() => {
                    let Some(item) = next else { break };
                    let chunk = match item {
                        Ok(bytes) => bytes,
                        Err(error) => return Err(ProviderError::Http(error.to_string())),
                    };
                    buffer.push_str(&String::from_utf8_lossy(&chunk));
                    for chunk in parse_sse_chunk(&mut buffer, &mut last_usage) {
                        if chunk.is_terminal {
                            emitted_done = true;
                            let _ = sink.send(ChatChunk {
                                delta: String::new(),
                                finish_reason: chunk.finish_reason.or(Some("stop".into())),
                                done: true,
                                prompt_tokens: chunk.prompt_tokens.or(last_usage.as_ref().and_then(|u| u.prompt_tokens)),
                                completion_tokens: chunk.completion_tokens.or(last_usage.as_ref().and_then(|u| u.completion_tokens)),
                            }).await;
                            return Ok(());
                        }
                        if sink.send(ChatChunk {
                            delta: chunk.delta,
                            finish_reason: chunk.finish_reason,
                            done: false,
                            prompt_tokens: chunk.prompt_tokens,
                            completion_tokens: chunk.completion_tokens,
                        }).await.is_err() {
                            return Ok(());
                        }
                    }
                }
            }
        }

        if !emitted_done {
            let _ = sink.send(ChatChunk {
                delta: String::new(),
                finish_reason: Some("stop".into()),
                done: true,
                prompt_tokens: last_usage.as_ref().and_then(|u| u.prompt_tokens),
                completion_tokens: last_usage.as_ref().and_then(|u| u.completion_tokens),
            }).await;
        }
        Ok(())
    }
}

/// One delta extracted from the OpenAI SSE stream. `delta` may be empty when
/// the chunk only carries `finish_reason` or a usage update.
#[derive(Debug, PartialEq, Eq)]
pub struct OpenAiDelta {
    pub delta: String,
    pub finish_reason: Option<String>,
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub is_terminal: bool,
}

/// Split a buffered chunk of SSE text into zero or more delta records. Lines
/// starting with `data:` are parsed; `[DONE]` marks the terminal record;
/// blank lines and unparseable lines are skipped silently. Any incomplete
/// trailing line stays in `buffer` for the next call.
pub fn parse_sse_chunk(buffer: &mut String, last_usage: &mut Option<OpenAIUsage>) -> Vec<OpenAiDelta> {
    let mut out: Vec<OpenAiDelta> = Vec::new();
    while let Some(idx) = buffer.find('\n') {
        let line: String = buffer.drain(..=idx).collect();
        let trimmed = line.trim_end_matches(['\n', '\r']);
        if trimmed.is_empty() {
            continue;
        }
        let Some(payload) = trimmed.strip_prefix("data:") else {
            continue;
        };
        let payload = payload.trim();
        if payload == "[DONE]" {
            out.push(OpenAiDelta {
                delta: String::new(),
                finish_reason: Some("stop".into()),
                prompt_tokens: None,
                completion_tokens: None,
                is_terminal: true,
            });
            continue;
        }
        let parsed: OpenAIStreamChunk = match serde_json::from_str(payload) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if let Some(usage) = parsed.usage.clone() {
            *last_usage = Some(usage);
        }
        let mut pushed = false;
        for choice in parsed.choices {
            let delta_text = choice
                .delta
                .as_ref()
                .and_then(|d| d.content.clone())
                .unwrap_or_default();
            if !delta_text.is_empty() || choice.finish_reason.is_some() {
                out.push(OpenAiDelta {
                    delta: delta_text,
                    finish_reason: choice.finish_reason.clone(),
                    prompt_tokens: None,
                    completion_tokens: None,
                    is_terminal: false,
                });
                pushed = true;
            }
        }
        if !pushed {
            if let Some(usage) = parsed.usage.as_ref() {
                out.push(OpenAiDelta {
                    delta: String::new(),
                    finish_reason: None,
                    prompt_tokens: usage.prompt_tokens,
                    completion_tokens: usage.completion_tokens,
                    is_terminal: false,
                });
            }
        }
    }
    out
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_parses_increments_and_done_marker() {
        let mut buf = String::new();
        let mut usage = None;
        buf.push_str("data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n");
        let first = parse_sse_chunk(&mut buf, &mut usage);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].delta, "Hel");
        assert!(!first[0].is_terminal);

        buf.push_str("data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n");
        buf.push_str("data: {\"choices\":[{\"finish_reason\":\"stop\"}]}\n");
        let second = parse_sse_chunk(&mut buf, &mut usage);
        assert_eq!(second.len(), 2);
        assert_eq!(second[0].delta, "lo");
        assert_eq!(second[1].finish_reason.as_deref(), Some("stop"));

        buf.push_str("data: [DONE]\n");
        let done = parse_sse_chunk(&mut buf, &mut usage);
        assert_eq!(done.len(), 1);
        assert!(done[0].is_terminal);
    }

    #[test]
    fn sse_skips_unknown_lines_and_empty_buffers() {
        let mut buf = String::new();
        let mut usage = None;
        let out = parse_sse_chunk(&mut buf, &mut usage);
        assert!(out.is_empty());
        buf.push_str("\n: ping\nnot-data\n");
        let out = parse_sse_chunk(&mut buf, &mut usage);
        assert!(out.is_empty());
    }

    #[test]
    fn sse_extracts_usage_when_choices_empty() {
        let mut buf = String::new();
        let mut usage = None;
        buf.push_str("data: {\"choices\":[],\"usage\":{\"prompt_tokens\":11,\"completion_tokens\":7}}\n");
        let out = parse_sse_chunk(&mut buf, &mut usage);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].prompt_tokens, Some(11));
        assert_eq!(out[0].completion_tokens, Some(7));
        assert_eq!(usage.unwrap().prompt_tokens, Some(11));
    }

    #[test]
    fn sse_keeps_trailing_partial_line_in_buffer() {
        let mut buf = String::new();
        let mut usage = None;
        buf.push_str("data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\ndata: {\"choices\":");
        let out = parse_sse_chunk(&mut buf, &mut usage);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].delta, "Hel");
        assert!(buf.contains("data: {\"choices\":"));
    }
}
