package document

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var ErrNotFound = errors.New("document not found")

type Repository interface {
	Create(context.Context, CreateInput) (Document, error)
	List(context.Context, string) ([]Document, error)
	Get(context.Context, string) (Document, error)
	Update(context.Context, string, UpdateInput) (Document, error)
	Delete(context.Context, string) error
}

type MemoryRepository struct {
	mu    sync.RWMutex
	seq   atomic.Uint64
	items map[string]Document
}

func NewMemoryRepository() *MemoryRepository {
	r := &MemoryRepository{items: make(map[string]Document)}
	for _, input := range []CreateInput{
		{Title: "Building reliable AI agents", URL: "https://example.com/agents", Source: "Example Research", Author: "Maya Chen", Language: "en", Markdown: "Agent systems need observable plans, bounded tools, and explicit approval for high-risk actions.", Tags: []string{"AI Agent", "Architecture"}},
		{Title: "Tauri 2 security architecture", URL: "https://example.com/tauri", Source: "Engineering Notes", Author: "Alex Lin", Language: "en", Markdown: "Tauri capabilities isolate WebView content from privileged Rust commands.", Tags: []string{"Rust", "Tauri", "Security"}},
	} {
		doc, _ := r.Create(context.Background(), input)
		doc.Status = StatusReady
		r.items[doc.ID] = doc
	}
	return r
}

func (r *MemoryRepository) Create(_ context.Context, in CreateInput) (Document, error) {
	now := time.Now().UTC()
	id := fmt.Sprintf("doc_%06d", r.seq.Add(1))
	body := in.Markdown
	if body == "" {
		body = in.Content
	}
	doc := Document{ID: id, Title: strings.TrimSpace(in.Title), URL: strings.TrimSpace(in.URL), Source: in.Source, Author: in.Author, Language: in.Language, Content: in.Content, Markdown: in.Markdown, CoverImage: in.CoverImage, WordCount: len(strings.Fields(body)), Status: StatusPending, Tags: in.Tags, CreatedAt: now, UpdatedAt: now}
	r.mu.Lock()
	r.items[id] = doc
	r.mu.Unlock()
	return doc, nil
}

func (r *MemoryRepository) List(_ context.Context, query string) ([]Document, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	q := strings.ToLower(strings.TrimSpace(query))
	result := make([]Document, 0, len(r.items))
	for _, item := range r.items {
		haystack := strings.ToLower(item.Title + " " + item.Markdown + " " + strings.Join(item.Tags, " "))
		if q == "" || strings.Contains(haystack, q) {
			result = append(result, item)
		}
	}
	return result, nil
}

func (r *MemoryRepository) Get(_ context.Context, id string) (Document, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.items[id]
	if !ok {
		return Document{}, ErrNotFound
	}
	return item, nil
}

func (r *MemoryRepository) Update(ctx context.Context, id string, in UpdateInput) (Document, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.items[id]
	if !ok {
		return Document{}, ErrNotFound
	}
	if in.Title != nil {
		item.Title = strings.TrimSpace(*in.Title)
	}
	if in.Summary != nil {
		item.Summary = *in.Summary
	}
	if in.Markdown != nil {
		item.Markdown = *in.Markdown
		item.WordCount = len(strings.Fields(*in.Markdown))
	}
	if in.Status != nil {
		item.Status = *in.Status
	}
	if in.Tags != nil {
		item.Tags = *in.Tags
	}
	if in.CollectionID != nil {
		item.CollectionID = *in.CollectionID
	}
	item.UpdatedAt = time.Now().UTC()
	r.items[id] = item
	return item, nil
}

func (r *MemoryRepository) Delete(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.items[id]; !ok {
		return ErrNotFound
	}
	delete(r.items, id)
	return nil
}
