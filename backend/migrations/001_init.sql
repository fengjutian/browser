PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, source TEXT,
  author TEXT, published_at TEXT, language TEXT, content TEXT, markdown TEXT,
  summary TEXT, cover_image TEXT, word_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('PENDING','PROCESSING','READY','FAILED','ARCHIVED')),
  collection_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS document_tags (document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(document_id, tag_id));
CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, content TEXT NOT NULL, chunk_index INTEGER NOT NULL, token_count INTEGER NOT NULL DEFAULT 0, embedding_id TEXT, metadata TEXT, created_at TEXT NOT NULL, UNIQUE(document_id, chunk_index));
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, type TEXT NOT NULL, path TEXT, url TEXT, hash TEXT, created_at TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(document_id UNINDEXED, title, markdown, summary, tags, tokenize='unicode61');
