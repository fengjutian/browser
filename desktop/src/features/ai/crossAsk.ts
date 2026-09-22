import type { ChatRequest, Document } from '../../types'

const SYSTEM_PROMPT = [
  'You answer questions using ONLY the numbered documents from the user’s personal knowledge base.',
  'Each document is labelled [doc-N] with its title, URL, and excerpt.',
  'If the knowledge base does not contain enough information to answer, reply exactly: "知识库中未找到相关信息。"',
  'Never use outside knowledge.',
  'After every factual sentence append the matching document IDs in square brackets, e.g. [doc-1][doc-3].',
  'If you cite a document, quote or paraphrase its content faithfully — do not invent numbers, names, or dates.',
  'Reply in the user’s question language.',
].join(' ')

const NOT_FOUND_MARKER = '知识库中未找到相关信息'
export const MAX_CHARS_PER_DOC = 1500

export interface CrossAskDoc {
  index: number
  id: string
  title: string
  url: string
  excerpt: string
}

export interface CrossAskParse {
  answer: string
  docIds: number[]
  notFound: boolean
}

export function buildCrossAskPrompt(
  documents: readonly Document[],
  question: string,
  history?: readonly { role: 'user' | 'assistant'; content: string }[],
): ChatRequest {
  const cited: CrossAskDoc[] = []
  documents.forEach((doc, position) => {
    const raw = (doc.markdown && doc.markdown.trim()) || (doc.summary && doc.summary.trim()) || ''
    if (!raw && !doc.title.trim()) return
    cited.push({
      index: position + 1,
      id: doc.id,
      title: doc.title,
      url: doc.url,
      excerpt: raw.slice(0, MAX_CHARS_PER_DOC),
    })
  })

  const block = cited.length === 0
    ? '(empty knowledge base)'
    : cited
        .map(doc => `[doc-${doc.index}] ${doc.title}\nURL: ${doc.url}\n\n${doc.excerpt}`)
        .join('\n\n---\n\n')

  const userMessage = [
    `Question: ${question.trim()}`,
    '',
    '---',
    '',
    block,
    '',
    '---',
    '',
    'Cite documents inline using [doc-N] tags. Reply in the question’s language.',
  ].join('\n')

  const messages: ChatRequest['messages'] = [{ role: 'system', content: SYSTEM_PROMPT }]
  if (history && history.length > 0) {
    messages.push(...history.map(entry => ({ role: entry.role, content: entry.content })))
  }
  messages.push({ role: 'user', content: userMessage })

  return { messages, temperature: 0.2 }
}

export function parseCrossAnswer(raw: string): CrossAskParse {
  const trimmed = raw.trim()
  if (trimmed.includes(NOT_FOUND_MARKER)) {
    return { answer: NOT_FOUND_MARKER, docIds: [], notFound: true }
  }
  const docIds = Array.from(new Set(
    Array.from(trimmed.matchAll(/\[doc-(\d+)\]/g))
      .map(match => Number(match[1]))
      .filter(value => Number.isFinite(value) && value > 0),
  ))
  return { answer: trimmed, docIds, notFound: false }
}
