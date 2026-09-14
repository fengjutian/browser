package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/example/ai-knowledge-browser/backend/internal/document"
)

func TestHealth(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/v1/health", nil)
	rec := httptest.NewRecorder()
	NewServer(document.NewMemoryRepository()).Handler().ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status=%d", rec.Code)
	}
}
func TestDocumentLifecycle(t *testing.T) {
	s := NewServer(document.NewMemoryRepository()).Handler()
	body := []byte(`{"title":"MCP overview","url":"https://example.com/mcp","markdown":"Model Context Protocol"}`)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest("POST", "/api/v1/documents", bytes.NewReader(body)))
	if rec.Code != 201 {
		t.Fatalf("create status=%d body=%s", rec.Code, rec.Body.String())
	}
	var created document.Document
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/documents/"+created.ID, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("get status=%d", rec.Code)
	}
}
func TestCreateValidation(t *testing.T) {
	rec := httptest.NewRecorder()
	NewServer(document.NewMemoryRepository()).Handler().ServeHTTP(rec, httptest.NewRequest("POST", "/api/v1/documents", bytes.NewBufferString(`{"title":""}`)))
	if rec.Code != 400 {
		t.Fatalf("status=%d", rec.Code)
	}
}
