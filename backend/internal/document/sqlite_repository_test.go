package document_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/example/ai-knowledge-browser/backend/internal/document"
	"github.com/example/ai-knowledge-browser/backend/internal/storage"
)

func TestSQLiteRepositoryPersistsAndSearches(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "knowledge.db")
	db, err := storage.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	repository := document.NewSQLiteRepository(db)
	created, err := repository.Create(ctx, document.CreateInput{Title: "Tauri security guide", URL: "https://example.com/tauri", Markdown: "capability isolation architecture", Tags: []string{"Rust", "Security"}})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}

	db, err = storage.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repository = document.NewSQLiteRepository(db)
	found, err := repository.List(ctx, "capability")
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != 1 || found[0].ID != created.ID || len(found[0].Tags) != 2 {
		t.Fatalf("unexpected search result: %#v", found)
	}
	if err = repository.Delete(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	found, err = repository.List(ctx, "capability")
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != 0 {
		t.Fatalf("deleted document remains in FTS: %#v", found)
	}
}
