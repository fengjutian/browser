package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/example/ai-knowledge-browser/backend/internal/document"
	api "github.com/example/ai-knowledge-browser/backend/internal/httpapi"
	"github.com/example/ai-knowledge-browser/backend/internal/storage"
)

func main() {
	addr := os.Getenv("AKB_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8787"
	}
	dataDir := os.Getenv("AKB_DATA_DIR")
	if dataDir == "" { dataDir = "data" }
	db, err := storage.Open(context.Background(), filepath.Join(dataDir, "knowledge.db"))
	if err != nil { log.Fatal(err) }
	defer db.Close()
	server := api.NewServer(document.NewSQLiteRepository(db))
	log.Printf("AI Knowledge Browser API listening on http://%s", addr)
	if err := http.ListenAndServe(addr, server.Handler()); err != nil {
		log.Fatal(err)
	}
}
