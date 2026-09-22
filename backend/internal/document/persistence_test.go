package document

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/example/ai-knowledge-browser/backend/internal/storage"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	ctx := context.Background()
	dir := t.TempDir()
	db, err := storage.Open(ctx, filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestSQLiteQueuePersistenceInsertAndPending(t *testing.T) {
	ctx := context.Background()
	db := openTestDB(t)
	store := NewSQLiteQueuePersistence(db)
	if err := store.Insert(ctx, "doc-1"); err != nil {
		t.Fatalf("insert 1: %v", err)
	}
	if err := store.Insert(ctx, "doc-2"); err != nil {
		t.Fatalf("insert 2: %v", err)
	}
	if err := store.Insert(ctx, "doc-1"); err != nil {
		t.Fatalf("insert dup: %v", err)
	}
	pending, err := store.Pending(ctx)
	if err != nil {
		t.Fatalf("pending: %v", err)
	}
	if len(pending) != 2 {
		t.Fatalf("expected 2 pending rows, got %d (%v)", len(pending), pending)
	}
	if pending[0] != "doc-1" || pending[1] != "doc-2" {
		t.Fatalf("pending order: %v", pending)
	}
}

func TestSQLiteQueuePersistenceCompleteRemovesRow(t *testing.T) {
	ctx := context.Background()
	db := openTestDB(t)
	store := NewSQLiteQueuePersistence(db)
	_ = store.Insert(ctx, "doc-1")
	_ = store.Insert(ctx, "doc-2")
	if err := store.Complete(ctx, "doc-1"); err != nil {
		t.Fatalf("complete: %v", err)
	}
	pending, _ := store.Pending(ctx)
	if len(pending) != 1 || pending[0] != "doc-2" {
		t.Fatalf("after complete: %v", pending)
	}
}

func TestProcessorRestoresPendingAfterRestart(t *testing.T) {
	ctx := context.Background()
	db := openTestDB(t)

	firstRepo := NewSQLiteRepository(db)
	doc1, _ := firstRepo.Create(ctx, CreateInput{Title: "First", URL: "https://example.com/1", Content: "alpha"})
	doc2, _ := firstRepo.Create(ctx, CreateInput{Title: "Second", URL: "https://example.com/2", Content: "beta"})

	queueStore := NewSQLiteQueuePersistence(db)
	firstProcessor := NewProcessorWithPersistence(firstRepo, 4, queueStore)
	firstProcessor.Enqueue(doc1.ID)
	firstProcessor.Enqueue(doc2.ID)
	pending, _ := queueStore.Pending(ctx)
	if len(pending) != 2 {
		t.Fatalf("expected 2 enqueued rows, got %d", len(pending))
	}

	// Simulate process restart — fresh Processor with the same DB.
	secondRepo := NewSQLiteRepository(db)
	secondProcessor := NewProcessorWithPersistence(secondRepo, 4, queueStore)
	restored, err := secondProcessor.RestorePending(ctx)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if restored != 2 {
		t.Fatalf("expected 2 restored, got %d", restored)
	}
	go secondProcessor.Run(ctx)
	waitForStatus(t, secondRepo, doc1.ID, StatusReady)
	waitForStatus(t, secondRepo, doc2.ID, StatusReady)
	pending, _ = queueStore.Pending(ctx)
	if len(pending) != 0 {
		t.Fatalf("expected queue drained, got %d (%v)", len(pending), pending)
	}
}

func TestNoopPersistenceIsNilSafe(t *testing.T) {
	ctx := context.Background()
	store := NoopPersistence{}
	if err := store.Insert(ctx, "x"); err != nil {
		t.Fatalf("noop insert: %v", err)
	}
	if err := store.Complete(ctx, "x"); err != nil {
		t.Fatalf("noop complete: %v", err)
	}
	pending, err := store.Pending(ctx)
	if err != nil || pending != nil {
		t.Fatalf("noop pending: %v %v", pending, err)
	}
}