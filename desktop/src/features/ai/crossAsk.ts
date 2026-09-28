import type { ChatRequest, Document } from '../../types'
import { rankByBm25 } from './bm25'

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
export const DEFAULT_TOP_K = 8

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

export interface CrossAskOptions {
  topK?: number
  maxCharsPerDoc?: number
  rankedDocumentIds?: readonly string[]
}

function excerptFor(doc: Document, maxChars: number): string {
  const raw = (doc.markdown && doc.markdown.trim()) || (doc.summary && doc.summary.trim()) || ''
  return raw.slice(0, maxChars)
}

export function buildCrossAskPrompt(
  documents: readonly Document[],
  question: string,
  history?: readonly { role: 'user' | 'assistant'; content: string }[],
  options?: CrossAskOptions,
): ChatRequest {
  const topK = options?.topK ?? DEFAULT_TOP_K
  const maxChars = options?.maxCharsPerDoc ?? MAX_CHARS_PER_DOC

  let chosen: { document: Document; originalIndex: number }[]
  if (options?.rankedDocumentIds?.length) {
    const rank = new Map(options.rankedDocumentIds.map((id,index)=>[id,index]))
    chosen = documents.map((document,originalIndex)=>({document,originalIndex})).filter(item=>rank.has(item.document.id)).sort((a,b)=>rank.get(a.document.id)!-rank.get(b.document.id)!).slice(0,topK)
  } else if (documents.length <= topK) {
    chosen = documents.map((doc, index) => ({ document: doc, originalIndex: index }))
  } else {
    chosen = rankByBm25(question, documents, doc => `${doc.title}\n${excerptFor(doc, maxChars)}`)
      .slice(0, topK)
      .map(entry => ({ document: entry.document, originalIndex: entry.originalIndex }))
  }

  const cited: CrossAskDoc[] = []
  chosen.forEach(({ document, originalIndex }) => {
    const excerpt = excerptFor(document, maxChars)
    if (!excerpt && !document.title.trim()) return
    cited.push({
      index: originalIndex + 1,
      id: document.id,
      title: document.title,
      url: document.url,
      excerpt,
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

/** Exact citation IDs exposed in the generated context, used as the answer allow-list. */
export function citationIdsInRequest(request:ChatRequest):number[]{const user=[...request.messages].reverse().find(message=>message.role==='user');if(!user)return[];return Array.from(new Set(Array.from(user.content.matchAll(/^\[doc-(\d+)\]\s/mg),match=>Number(match[1])).filter(value=>Number.isInteger(value)&&value>0)))}
