package document

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

type SQLiteRepository struct{ db *sql.DB }

func NewSQLiteRepository(db *sql.DB) *SQLiteRepository { return &SQLiteRepository{db: db} }
func newID() string {
	var value [12]byte
	_, _ = rand.Read(value[:])
	return "doc_" + hex.EncodeToString(value[:])
}

func (r *SQLiteRepository) Create(ctx context.Context, in CreateInput) (Document, error) {
	now := time.Now().UTC()
	body := in.Markdown
	if body == "" {
		body = in.Content
	}
	doc := Document{ID: newID(), Title: strings.TrimSpace(in.Title), URL: strings.TrimSpace(in.URL), Source: in.Source, Author: in.Author, Language: in.Language, Content: in.Content, Markdown: in.Markdown, CoverImage: in.CoverImage, WordCount: len(strings.Fields(body)), Status: StatusPending, Tags: cleanTags(in.Tags), CreatedAt: now, UpdatedAt: now}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Document{}, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO documents(id,title,url,source,author,language,content,markdown,cover_image,word_count,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, doc.ID, doc.Title, doc.URL, doc.Source, doc.Author, doc.Language, doc.Content, doc.Markdown, doc.CoverImage, doc.WordCount, doc.Status, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	if err != nil {
		return Document{}, err
	}
	if err = replaceTags(ctx, tx, doc.ID, doc.Tags, now); err != nil {
		return Document{}, err
	}
	if err = replaceFTS(ctx, tx, doc); err != nil {
		return Document{}, err
	}
	return doc, tx.Commit()
}

func (r *SQLiteRepository) List(ctx context.Context, query string) ([]Document, error) {
	args := []any{}
	where := ""
	if strings.TrimSpace(query) != "" {
		where = "WHERE d.id IN (SELECT document_id FROM documents_fts WHERE documents_fts MATCH ?)"
		args = append(args, ftsQuery(query))
	}
	rows, err := r.db.QueryContext(ctx, `SELECT d.id,d.title,d.url,d.source,d.author,d.language,d.content,d.markdown,d.summary,d.cover_image,d.word_count,d.status,d.collection_id,d.created_at,d.updated_at,COALESCE(group_concat(t.name, char(31)),'') FROM documents d LEFT JOIN document_tags dt ON dt.document_id=d.id LEFT JOIN tags t ON t.id=dt.tag_id `+where+` GROUP BY d.id ORDER BY d.created_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Document{}
	for rows.Next() {
		item, err := scanDocument(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *SQLiteRepository) Get(ctx context.Context, id string) (Document, error) {
	row := r.db.QueryRowContext(ctx, `SELECT d.id,d.title,d.url,d.source,d.author,d.language,d.content,d.markdown,d.summary,d.cover_image,d.word_count,d.status,d.collection_id,d.created_at,d.updated_at,COALESCE(group_concat(t.name, char(31)),'') FROM documents d LEFT JOIN document_tags dt ON dt.document_id=d.id LEFT JOIN tags t ON t.id=dt.tag_id WHERE d.id=? GROUP BY d.id`, id)
	item, err := scanDocument(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Document{}, ErrNotFound
	}
	return item, err
}

func (r *SQLiteRepository) Update(ctx context.Context, id string, in UpdateInput) (Document, error) {
	doc, err := r.Get(ctx, id)
	if err != nil {
		return Document{}, err
	}
	if in.Title != nil {
		doc.Title = strings.TrimSpace(*in.Title)
	}
	if in.Summary != nil {
		doc.Summary = *in.Summary
	}
	if in.Markdown != nil {
		doc.Markdown = *in.Markdown
		doc.WordCount = len(strings.Fields(*in.Markdown))
	}
	if in.Status != nil {
		doc.Status = *in.Status
	}
	if in.Tags != nil {
		doc.Tags = cleanTags(*in.Tags)
	}
	if in.CollectionID != nil {
		doc.CollectionID = *in.CollectionID
	}
	doc.UpdatedAt = time.Now().UTC()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Document{}, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `UPDATE documents SET title=?,summary=?,markdown=?,word_count=?,status=?,collection_id=?,updated_at=? WHERE id=?`, doc.Title, doc.Summary, doc.Markdown, doc.WordCount, doc.Status, doc.CollectionID, doc.UpdatedAt.Format(time.RFC3339Nano), id)
	if err != nil {
		return Document{}, err
	}
	if in.Tags != nil {
		if err = replaceTags(ctx, tx, id, doc.Tags, doc.UpdatedAt); err != nil {
			return Document{}, err
		}
	}
	if err = replaceFTS(ctx, tx, doc); err != nil {
		return Document{}, err
	}
	return doc, tx.Commit()
}

func (r *SQLiteRepository) Delete(ctx context.Context, id string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, "DELETE FROM documents WHERE id=?", id)
	if err != nil {
		return err
	}
	count, _ := res.RowsAffected()
	if count == 0 {
		return ErrNotFound
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM documents_fts WHERE document_id=?", id); err != nil {
		return err
	}
	return tx.Commit()
}

type scanner interface{ Scan(...any) error }

func scanDocument(s scanner) (Document, error) {
	var d Document
	var status, created, updated, tags string
	err := s.Scan(&d.ID, &d.Title, &d.URL, &d.Source, &d.Author, &d.Language, &d.Content, &d.Markdown, &d.Summary, &d.CoverImage, &d.WordCount, &status, &d.CollectionID, &created, &updated, &tags)
	if err != nil {
		return d, err
	}
	d.Status = Status(status)
	d.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	d.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	d.Tags = []string{}
	if tags != "" {
		d.Tags = strings.Split(tags, string(rune(31)))
	}
	return d, nil
}
func cleanTags(tags []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag != "" && !seen[tag] {
			seen[tag] = true
			result = append(result, tag)
		}
	}
	return result
}
func replaceTags(ctx context.Context, tx *sql.Tx, id string, tags []string, now time.Time) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM document_tags WHERE document_id=?", id); err != nil {
		return err
	}
	for _, tag := range tags {
		if _, err := tx.ExecContext(ctx, "INSERT INTO tags(name,created_at) VALUES(?,?) ON CONFLICT(name) DO NOTHING", tag, now.Format(time.RFC3339Nano)); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO document_tags(document_id,tag_id) SELECT ?,id FROM tags WHERE name=?", id, tag); err != nil {
			return err
		}
	}
	return nil
}
func replaceFTS(ctx context.Context, tx *sql.Tx, d Document) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM documents_fts WHERE document_id=?", d.ID); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, "INSERT INTO documents_fts(document_id,title,markdown,summary,tags) VALUES(?,?,?,?,?)", d.ID, d.Title, d.Markdown, d.Summary, strings.Join(d.Tags, " "))
	return err
}
func ftsQuery(query string) string {
	terms := strings.Fields(query)
	for i, term := range terms {
		terms[i] = `"` + strings.ReplaceAll(term, `"`, `""`) + `"*`
	}
	return strings.Join(terms, " AND ")
}
