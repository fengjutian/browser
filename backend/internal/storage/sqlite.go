package storage

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

func Open(ctx context.Context, path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}
	db, err := sql.Open("sqlite", path+"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	if err = db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err = migrate(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func migrate(ctx context.Context, db *sql.DB) error {
	const schema = `CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL,source TEXT NOT NULL DEFAULT '',author TEXT NOT NULL DEFAULT '',published_at TEXT,language TEXT NOT NULL DEFAULT '',content TEXT NOT NULL DEFAULT '',markdown TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL DEFAULT '',cover_image TEXT NOT NULL DEFAULT '',word_count INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL CHECK(status IN ('PENDING','PROCESSING','READY','FAILED','ARCHIVED')),collection_id TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS document_tags (document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,PRIMARY KEY(document_id,tag_id));
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(document_id UNINDEXED,title,markdown,summary,tags,tokenize='unicode61');
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC);`
	_, err := db.ExecContext(ctx, schema)
	return err
}
