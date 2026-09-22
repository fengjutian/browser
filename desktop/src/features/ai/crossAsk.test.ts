import { describe, expect, it } from 'vitest'
import { MAX_CHARS_PER_DOC, buildCrossAskPrompt, parseCrossAnswer } from './crossAsk'
import type { Document } from '../../types'

function makeDoc(partial: Partial<Document>): Document {
  return {
    id: partial.id ?? 'doc',
    title: partial.title ?? 'untitled',
    url: partial.url ?? 'https://example.com',
    markdown: partial.markdown,
    summary: partial.summary,
    wordCount: partial.wordCount ?? 0,
    status: partial.status ?? 'READY',
    tags: partial.tags ?? [],
    createdAt: partial.createdAt ?? '2024-01-01',
    starred: partial.starred ?? false,
  }
}

describe('crossAsk helpers', () => {
  it('numbers every kept document and includes its URL', () => {
    const docs = [
      makeDoc({ id: 'a', title: 'Alpha', url: 'https://a', markdown: 'alpha body' }),
      makeDoc({ id: 'b', title: 'Beta', url: 'https://b', markdown: 'beta body' }),
    ]
    const request = buildCrossAskPrompt(docs, 'What is alpha?')
    expect(request.messages[0].role).toBe('system')
    expect(request.messages[0].content).toContain('ONLY the numbered documents')
    const user = request.messages[1].content
    expect(user).toContain('Question: What is alpha?')
    expect(user).toContain('[doc-1] Alpha')
    expect(user).toContain('[doc-2] Beta')
    expect(user).toContain('https://a')
    expect(user).toContain('https://b')
    expect(user).toContain('alpha body')
    expect(user).toContain('beta body')
  })

  it('truncates long markdown excerpts to MAX_CHARS_PER_DOC', () => {
    const long = 'x'.repeat(MAX_CHARS_PER_DOC + 500)
    const request = buildCrossAskPrompt([makeDoc({ id: 'x', markdown: long })], 'Q')
    const user = request.messages[1].content
    expect(user).toContain('x'.repeat(MAX_CHARS_PER_DOC))
    expect(user).not.toContain('x'.repeat(MAX_CHARS_PER_DOC + 1))
  })

  it('falls back to summary when markdown is empty', () => {
    const docs = [
      makeDoc({ id: 's', title: 'Summary Only', url: 'https://s', markdown: '', summary: 'short summary text' }),
    ]
    const request = buildCrossAskPrompt(docs, 'Q')
    const user = request.messages[1].content
    expect(user).toContain('[doc-1] Summary Only')
    expect(user).toContain('short summary text')
  })

  it('parses [doc-N] citations and dedupes them in first-seen order', () => {
    const parsed = parseCrossAnswer('Alpha is fast [doc-2]. Beta agrees [doc-1][doc-2].')
    expect(parsed.notFound).toBe(false)
    expect(parsed.docIds).toEqual([2, 1])
  })

  it('ignores malformed or non-positive doc ids', () => {
    const parsed = parseCrossAnswer('mix [doc-1] [doc-0] [doc-x] [doc-3]')
    expect(parsed.docIds).toEqual([1, 3])
  })

  it('detects the not-found response and clears citations', () => {
    const parsed = parseCrossAnswer('知识库中未找到相关信息。')
    expect(parsed.notFound).toBe(true)
    expect(parsed.docIds).toEqual([])
  })
})
