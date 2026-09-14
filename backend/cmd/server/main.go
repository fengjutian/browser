package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/example/ai-knowledge-browser/backend/internal/document"
	api "github.com/example/ai-knowledge-browser/backend/internal/httpapi"
	"github.com/example/ai-knowledge-browser/backend/internal/storage"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	addr := os.Getenv("AKB_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8787"
	}
	dataDir := os.Getenv("AKB_DATA_DIR")
	if dataDir == "" {
		dataDir = "data"
	}
	db, err := storage.Open(ctx, filepath.Join(dataDir, "knowledge.db"))
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	repository := document.NewSQLiteRepository(db)
	processor := document.NewProcessor(repository, 128)
	go processor.Run(ctx)
	server := api.NewServerWithProcessor(repository, processor)
	log.Printf("AI Knowledge Browser API listening on http://%s", addr)
	if err := http.ListenAndServe(addr, server.Handler()); err != nil {
		log.Fatal(err)
	}
}
