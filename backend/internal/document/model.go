package document

import "time"

type Status string

const (
	StatusPending    Status = "PENDING"
	StatusProcessing Status = "PROCESSING"
	StatusReady      Status = "READY"
	StatusFailed     Status = "FAILED"
	StatusArchived   Status = "ARCHIVED"
)

type Document struct {
	ID           string     `json:"id"`
	Title        string     `json:"title"`
	URL          string     `json:"url"`
	Source       string     `json:"source,omitempty"`
	Author       string     `json:"author,omitempty"`
	PublishedAt  *time.Time `json:"publishedAt,omitempty"`
	Language     string     `json:"language,omitempty"`
	Content      string     `json:"content,omitempty"`
	Markdown     string     `json:"markdown,omitempty"`
	Summary      string     `json:"summary,omitempty"`
	CoverImage   string     `json:"coverImage,omitempty"`
	WordCount    int        `json:"wordCount"`
	Status       Status     `json:"status"`
	Tags         []string   `json:"tags"`
	CollectionID string     `json:"collectionId,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

type CreateInput struct {
	Title      string   `json:"title"`
	URL        string   `json:"url"`
	Source     string   `json:"source"`
	Author     string   `json:"author"`
	Language   string   `json:"language"`
	Content    string   `json:"content"`
	Markdown   string   `json:"markdown"`
	CoverImage string   `json:"coverImage"`
	Tags       []string `json:"tags"`
}

type UpdateInput struct {
	Title        *string   `json:"title"`
	Summary      *string   `json:"summary"`
	Markdown     *string   `json:"markdown"`
	Status       *Status   `json:"status"`
	Tags         *[]string `json:"tags"`
	CollectionID *string   `json:"collectionId"`
}
