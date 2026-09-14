package document

import (
	"context"
	"testing"
	"time"
)

func TestProcessorMarksDocumentReady(t *testing.T) {
	repository := NewMemoryRepository()
	doc, _ := repository.Create(context.Background(), CreateInput{Title: "Reader article", URL: "https://example.com", Content: "article body"})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	processor := NewProcessor(repository, 4)
	go processor.Run(ctx)
	if !processor.Enqueue(doc.ID) {
		t.Fatal("enqueue failed")
	}
	waitForStatus(t, repository, doc.ID, StatusReady)
	updated, _ := repository.Get(context.Background(), doc.ID)
	if updated.Markdown != "article body" {
		t.Fatalf("markdown=%q", updated.Markdown)
	}
}

func TestProcessorMarksEmptyDocumentFailed(t *testing.T) {
	repository := NewMemoryRepository()
	doc, _ := repository.Create(context.Background(), CreateInput{Title: "Empty", URL: "https://example.com"})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	processor := NewProcessor(repository, 4)
	go processor.Run(ctx)
	processor.Enqueue(doc.ID)
	waitForStatus(t, repository, doc.ID, StatusFailed)
}

func waitForStatus(t *testing.T, repository Repository, id string, expected Status) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		doc, _ := repository.Get(context.Background(), id)
		if doc.Status == expected {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	doc, _ := repository.Get(context.Background(), id)
	t.Fatalf("status=%s, expected=%s", doc.Status, expected)
}
