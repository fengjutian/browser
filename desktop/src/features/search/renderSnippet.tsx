import { Fragment, type ReactNode } from 'react'

/**
 * Parse the FTS5 `snippet()` output and render it as a sequence of React nodes.
 * Only `<mark>` and `</mark>` tags produced by SQLite are recognised; anything
 * else passes through as a plain text node so the user can never see arbitrary
 * HTML injected through the database.
 */
export function renderHighlightedSnippet(snippet: string | null | undefined): ReactNode {
  if (!snippet) return null
  if (snippet.length === 0) return null
  const parts = snippet.split(/(<mark>|<\/mark>)/g)
  const nodes: ReactNode[] = []
  let open = false
  for (const part of parts) {
    if (part === '<mark>') {
      open = true
      continue
    }
    if (part === '</mark>') {
      open = false
      continue
    }
    if (part.length === 0) continue
    if (open) {
      nodes.push(<mark key={nodes.length} className="search-highlight">{part}</mark>)
    } else {
      nodes.push(<Fragment key={nodes.length}>{part}</Fragment>)
    }
  }
  return nodes
}
