package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/example/ai-knowledge-browser/backend/internal/document"
)

type Server struct {
	documents document.Repository
	processor *document.Processor
	mux       *http.ServeMux
}

func NewServer(repo document.Repository) *Server {
	s := &Server{documents: repo, mux: http.NewServeMux()}
	s.routes()
	return s
}

func NewServerWithProcessor(repo document.Repository, processor *document.Processor) *Server {
	server := NewServer(repo)
	server.processor = processor
	return server
}

func (s *Server) Handler() http.Handler { return cors(s.mux) }

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"status": "ok", "version": "0.1.0"})
	})
	s.mux.HandleFunc("GET /api/v1/documents", s.listDocuments)
	s.mux.HandleFunc("POST /api/v1/documents", s.createDocument)
	s.mux.HandleFunc("GET /api/v1/documents/{id}", s.getDocument)
	s.mux.HandleFunc("PUT /api/v1/documents/{id}", s.updateDocument)
	s.mux.HandleFunc("DELETE /api/v1/documents/{id}", s.deleteDocument)
	s.mux.HandleFunc("GET /api/v1/search", s.search)
	s.mux.HandleFunc("POST /api/v1/search", s.searchPost)
	s.mux.HandleFunc("POST /api/v1/knowledge/search", s.searchPost)
	s.mux.HandleFunc("GET /api/v1/knowledge", s.knowledge)
	s.mux.HandleFunc("GET /api/v1/plugins", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"items": []any{}, "runtimeAvailable": false})
	})
	for _, path := range []string{"/api/v1/ai/chat", "/api/v1/ai/summary", "/api/v1/ai/translate", "/api/v1/agent/run"} {
		s.mux.HandleFunc("POST "+path, notImplemented)
	}
}

func (s *Server) listDocuments(w http.ResponseWriter, r *http.Request) {
	items, _ := s.documents.List(r.Context(), r.URL.Query().Get("q"))
	writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
}
func (s *Server) createDocument(w http.ResponseWriter, r *http.Request) {
	var in document.CreateInput
	if err := decode(r, &in); err != nil || strings.TrimSpace(in.Title) == "" || strings.TrimSpace(in.URL) == "" {
		writeError(w, 400, "validation_error", "title and url are required")
		return
	}
	item, err := s.documents.Create(r.Context(), in)
	if err != nil {
		writeError(w, 500, "internal_error", "unable to create document")
		return
	}
	if s.processor != nil && !s.processor.Enqueue(item.ID) {
		writeError(w, 503, "queue_full", "document was saved but processing queue is full")
		return
	}
	writeJSON(w, 201, item)
}
func (s *Server) getDocument(w http.ResponseWriter, r *http.Request) {
	item, err := s.documents.Get(r.Context(), r.PathValue("id"))
	if errors.Is(err, document.ErrNotFound) {
		writeError(w, 404, "not_found", "document not found")
		return
	}
	writeJSON(w, 200, item)
}
func (s *Server) updateDocument(w http.ResponseWriter, r *http.Request) {
	var in document.UpdateInput
	if err := decode(r, &in); err != nil {
		writeError(w, 400, "validation_error", "invalid JSON body")
		return
	}
	item, err := s.documents.Update(r.Context(), r.PathValue("id"), in)
	if errors.Is(err, document.ErrNotFound) {
		writeError(w, 404, "not_found", "document not found")
		return
	}
	writeJSON(w, 200, item)
}
func (s *Server) deleteDocument(w http.ResponseWriter, r *http.Request) {
	if err := s.documents.Delete(r.Context(), r.PathValue("id")); errors.Is(err, document.ErrNotFound) {
		writeError(w, 404, "not_found", "document not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	s.writeSearch(w, r, r.URL.Query().Get("q"))
}
func (s *Server) searchPost(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Query string `json:"query"`
	}
	if decode(r, &body) != nil || strings.TrimSpace(body.Query) == "" {
		writeError(w, 400, "validation_error", "query is required")
		return
	}
	s.writeSearch(w, r, body.Query)
}
func (s *Server) writeSearch(w http.ResponseWriter, r *http.Request, q string) {
	items, _ := s.documents.List(r.Context(), q)
	writeJSON(w, 200, map[string]any{"query": q, "mode": "keyword", "items": items, "total": len(items)})
}
func (s *Server) knowledge(w http.ResponseWriter, r *http.Request) {
	items, _ := s.documents.List(r.Context(), "")
	tags := map[string]bool{}
	for _, d := range items {
		for _, t := range d.Tags {
			tags[t] = true
		}
	}
	writeJSON(w, 200, map[string]any{"documents": len(items), "tags": len(tags), "collections": 0})
}

func decode(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
func notImplemented(w http.ResponseWriter, _ *http.Request) {
	writeError(w, 501, "provider_not_configured", "this capability is not configured yet")
}
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "http://localhost:1420")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}
