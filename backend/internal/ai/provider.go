package ai

import "context"

type ChatRequest struct {
	Messages []Message `json:"messages"`
	Model    string    `json:"model,omitempty"`
}
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type ChatResponse struct {
	Content string `json:"content"`
	Model   string `json:"model"`
}

type LLM interface {
	Chat(context.Context, ChatRequest) (ChatResponse, error)
}
type Embedding interface {
	Embed(context.Context, []string) ([][]float32, error)
}
type Reranker interface {
	Rerank(context.Context, string, []string) ([]float32, error)
}
