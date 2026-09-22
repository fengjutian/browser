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
	persistence QueuePersistence
}

func NewProcessor(repository Repository, capacity int) *Processor {
	return NewProcessorWithPersistence(repository, capacity, NoopPersistence{})
}

func NewProcessorWithPersistence(repository Repository, capacity int, persistence QueuePersistence) *Processor {
	if capacity < 1 {
		capacity = 64
	}
	if persistence == nil {
		persistence = NoopPersistence{}
	}
	return &Processor{repository: repository, queue: make(chan string, capacity), persistence: persistence}
}
func (p *Processor) Enqueue(documentID string) bool {
	if _, loaded := p.pending.LoadOrStore(documentID, struct{}{}); loaded {
		return true
	}
	select {
	case p.queue <- documentID:
		if err := p.persistence.Insert(context.Background(), documentID); err != nil {
			log.Printf("persist enqueue %s: %v", documentID, err)
		}
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
			if err := p.persistence.Complete(ctx, id); err != nil {
				log.Printf("persist complete %s: %v", id, err)
			}
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

// RestorePending loads any documents that were queued in a previous process
// run and feeds them back into the in-memory queue. Call once before Run.
func (p *Processor) RestorePending(ctx context.Context) (int, error) {
	if p.persistence == nil {
		return 0, nil
	}
	pending, err := p.persistence.Pending(ctx)
	if err != nil {
		return 0, err
	}
	restored := 0
	for _, id := range pending {
		if !p.Enqueue(id) {
			continue
		}
		restored++
	}
	return restored, nil
}
