package document

import (
	"context"
	"log"
	"strings"
	"sync"
)

type Processor struct {
	repository Repository
	queue      chan string
	pending    sync.Map
}

func NewProcessor(repository Repository, capacity int) *Processor {
	if capacity < 1 {
		capacity = 64
	}
	return &Processor{repository: repository, queue: make(chan string, capacity)}
}
func (p *Processor) Enqueue(documentID string) bool {
	if _, loaded := p.pending.LoadOrStore(documentID, struct{}{}); loaded {
		return true
	}
	select {
	case p.queue <- documentID:
		return true
	default:
		p.pending.Delete(documentID)
		return false
	}
}
func (p *Processor) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case id := <-p.queue:
			p.process(ctx, id)
			p.pending.Delete(id)
		}
	}
}
func (p *Processor) process(ctx context.Context, id string) {
	processing := StatusProcessing
	if _, err := p.repository.Update(ctx, id, UpdateInput{Status: &processing}); err != nil {
		log.Printf("process document %s: %v", id, err)
		return
	}
	doc, err := p.repository.Get(ctx, id)
	if err != nil {
		return
	}
	markdown := strings.TrimSpace(doc.Markdown)
	if markdown == "" {
		markdown = strings.TrimSpace(doc.Content)
	}
	if markdown == "" {
		failed := StatusFailed
		_, _ = p.repository.Update(ctx, id, UpdateInput{Status: &failed})
		return
	}
	ready := StatusReady
	if _, err = p.repository.Update(ctx, id, UpdateInput{Markdown: &markdown, Status: &ready}); err != nil {
		log.Printf("finish document %s: %v", id, err)
	}
}
