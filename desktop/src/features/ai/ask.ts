import type { ChatRequest } from '../../types'

const SYSTEM_PROMPT = [
  'You answer questions using ONLY the numbered passages from the document the user provides.',
  'If the document does not contain enough information to answer, reply: "当前页面未提供相关信息。"',
  'Never use outside knowledge.',
  'After every factual sentence append the matching passage IDs in square brackets, e.g. [p1][p3].',
  'If you cite a passage, quote or paraphrase its content faithfully — do not invent numbers, names, or dates.',
].join(' ')

const PARAGRAPH_MARKER = '__ASK_PARA__'

export interface NumberedPassage {
  id: string
  text: string
}

export function numberPassages(markdown: string): NumberedPassage[] {
  return markdown
    .split(/\n{2,}/)
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0)
    .map((segment, index) => ({ id: `p${index + 1}`, text: segment }))
}

export function buildAskPrompt(markdown: string, question: string, articleTitle?: string): ChatRequest {
  const passages = numberPassages(markdown)
  const passageBlock = passages
    .map(passage => `[${passage.id}] ${passage.text}`)
    .join('\n\n')
  const userMessage = [
    articleTitle ? `# ${articleTitle}` : '# Document',
    '',
    passageBlock,
    '',
    '---',
    '',
    `Question: ${question.trim()}`,
    '',
    'Reply in the document\'s primary language. Cite passages inline like [p2].',
  ].join('\n')
  return { messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage }], temperature: 0.1 }
}

export interface ParsedAnswer {
  answer: string
  citations: string[]
  notFound: boolean
}

const NOT_FOUND_MARKER = '当前页面未提供相关信息'

export function parseAnswer(raw: string): ParsedAnswer {
  const trimmed = raw.trim()
  if (trimmed.includes(NOT_FOUND_MARKER)) {
    return { answer: NOT_FOUND_MARKER, citations: [], notFound: true }
  }
  const citations = Array.from(new Set(Array.from(trimmed.matchAll(/\[(p\d+)\]/g)).map(match => match[1])))
  return { answer: trimmed, citations, notFound: false }
}

export function passageById(passages: NumberedPassage[], id: string): NumberedPassage | undefined {
  return passages.find(passage => passage.id === id)
}

// Marker re-exported to keep a single source of truth if external callers want to use the same splitter
export const ASK_PARA_MARKER = PARAGRAPH_MARKER
