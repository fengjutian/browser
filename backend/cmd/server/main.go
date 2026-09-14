package main

import (
	"log"
	"net/http"
	"os"

	"github.com/example/ai-knowledge-browser/backend/internal/document"
	api "github.com/example/ai-knowledge-browser/backend/internal/httpapi"
)

func main() {
	addr := os.Getenv("AKB_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8787"
	}
	server := api.NewServer(document.NewMemoryRepository())
	log.Printf("AI Knowledge Browser API listening on http://%s", addr)
	if err := http.ListenAndServe(addr, server.Handler()); err != nil {
		log.Fatal(err)
	}
}
