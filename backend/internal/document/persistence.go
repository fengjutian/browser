package document

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"
)

// QueuePersistence persists the processor's pending set so it survives
// process restarts. Insert is idempotent on the document id (re-queueing a
// still-pending id is a no-op). Complete removes the row once the document
// reaches a terminal status. Pending returns every row that is not yet
// complete and is used at startup to repopulate the in-memory channel.
type QueuePersistence interface {
	Insert(ctx context.Context, documentID string) error
	Complete(ctx context.Context, documentID string) error
	Pending(ctx context.Context) ([]string, error)
}

// NoopPersistence disables persistence (used by tests that only care about
// the in-memory channel).
type NoopPersistence struct{}

func (NoopPersistence) Insert(context.Context, string) error     { return nil }
func (NoopPersistence) Complete(context.Context, string) error   { return nil }
func (NoopPersistence) Pending(context.Context) ([]string, error) { return nil, nil }

// SQLiteQueuePersistence backs the queue with a small `processor_queue` table.
// Schema is added in storage.migrate. Rows are inserted on Enqueue and
// deleted on Complete.
type SQLiteQueuePersistence struct {
	db *sql.DB
	mu sync.Mutex // serialise Insert so the dedup races in original two stay pure
}

func NewSQLiteQueuePersistence(db *sql.DB) *SQLiteQueuePersistence {
	return &SQLiteQueuePersistence{db: db}
}

func (s *SQLiteQueuePersistence) Insert(ctx context.Context, documentID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO processor_queue(document_id, enqueued_at, updated_at) VALUES(?, ?, ?)
		 ON CONFLICT(document_id) DO UPDATE SET updated_at=excluded.updated_at`,
		documentID, now, now,
	)
	return err
}

func (s *SQLiteQueuePersistence) Complete(ctx context.Context, documentID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM processor_queue WHERE document_id=?`, documentID)
	return err
}

func (s *SQLiteQueuePersistence) Pending(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT document_id FROM processor_queue ORDER BY enqueued_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list pending queue: %w", err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ErrQueuePersistenceUnavailable is returned when persistence is required but
// no implementation was supplied.
var ErrQueuePersistenceUnavailable = errors.New("queue persistence not configured")