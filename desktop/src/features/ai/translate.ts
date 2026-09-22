import type { ChatRequest } from '../../types'

const SYSTEM_PROMPT = [
  'You are a precise translator.',
  'Preserve the document structure exactly: headings, bullet lists, numbered lists, code fences, blockquotes, and tables.',
  'Do not add or remove content. Translate inline code identifiers, comments, and string literals as code, not prose.',
  'Keep proper nouns and brand names in their original form unless the document itself provides a translation.',
  'Reply with the translated document only, no preamble.',
].join(' ')

export type TranslationView = 'translation-only' | 'bilingual'

export interface TranslateInput {
  markdown: string
  targetLanguage: string
  sourceHint?: string
  view: TranslationView
}

export interface TranslateChunk {
  index: number
  text: string
}

const CHARS_PER_CHUNK = 6000

export function splitForTranslation(markdown: string): TranslateChunk[] {
  const trimmed = markdown.trim()
  if (!trimmed) return []
  if (trimmed.length <= CHARS_PER_CHUNK) return [{ index: 0, text: trimmed }]
  const chunks: TranslateChunk[] = []
  let cursor = 0
  let index = 0
  while (cursor < trimmed.length) {
    const end = Math.min(trimmed.length, cursor + CHARS_PER_CHUNK)
    let breakAt = end
    if (end < trimmed.length) {
      const boundary = trimmed.lastIndexOf('\n\n', end)
      if (boundary > cursor + CHARS_PER_CHUNK / 2) breakAt = boundary
    }
    chunks.push({ index, text: trimmed.slice(cursor, breakAt).trim() })
    cursor = breakAt
    index += 1
  }
  return chunks
}

export function buildTranslatePrompt({ markdown, targetLanguage, sourceHint, view }: TranslateInput): ChatRequest {
  const chunks = splitForTranslation(markdown)
  const userMessage = [
    `# Source${sourceHint ? ` (${sourceHint})` : ''}`,
    '',
    view === 'bilingual' ? 'Output bilingual: keep each source line, then its translation beneath it as a blockquote ("> …").' : 'Output only the translation; no source text.',
    `Target language: ${targetLanguage}.`,
    '',
    '---',
    '',
    ...(chunks.length === 1
      ? [chunks[0].text]
      : chunks.map(chunk => `## Part ${chunk.index + 1}\n\n${chunk.text}`)),
  ].join('\n')
  return { messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage }], temperature: 0.1 }
}

export function translationKey({ markdown, targetLanguage, view }: TranslateInput): string {
  return `${view}|${targetLanguage}|${markdown.length}|hash:${simpleHash(markdown)}`
}

function simpleHash(input: string): string {
  let hash = 5381
  for (let index = 0; index < input.length; index++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index)
  }
  return (hash >>> 0).toString(16)
}

export const TRANSLATION_VIEW_LABEL: Record<TranslationView, string> = {
  'translation-only': '仅译文',
  bilingual: '中英对照',
}
