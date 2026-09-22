import type { ChatMessage, ChatRequest } from '../../types'

export type SummaryKind = 'one-sentence' | 'short' | 'detailed' | 'key-points'

const SYSTEM_PROMPT = [
  'You are a precise summarization assistant.',
  'You only summarize the document the user provides.',
  'Never invent facts, numbers, or sources that are not in the document.',
  'If the document lacks the requested information, say so explicitly.',
].join(' ')

const INSTRUCTIONS: Record<SummaryKind, string> = {
  'one-sentence': 'Write exactly one sentence (≤ 40 words) capturing the single most important claim. Respond in the document\'s primary language.',
  short: 'Write a concise summary in 3-5 sentences (≈ 100 words). Respond in the document\'s primary language.',
  detailed: 'Write a structured summary with short sections that cover background, main arguments, evidence, and conclusions. Use markdown headings. Respond in the document\'s primary language.',
  'key-points': 'List 5-8 bullet points capturing the most important takeaways. Each bullet must be a complete sentence. Respond in the document\'s primary language.',
}

const CHARS_PER_CHUNK = 12000
const MERGE_INSTRUCTION = 'The following partial summaries cover the same long article. Merge them into one coherent summary that preserves every key point and removes duplication. Keep the same summary style requested.'

export function buildSummaryPrompt(markdown: string, kind: SummaryKind, articleTitle?: string): ChatRequest {
  const chunks = splitMarkdown(markdown, CHARS_PER_CHUNK)
  if (chunks.length === 1) {
    return { messages: [directPrompt(chunks[0], kind, articleTitle)], temperature: 0.2 }
  }
  const partialsPrompt: ChatMessage = {
    role: 'user',
    content: [
      `# ${articleTitle ?? 'Document'}`,
      '',
      ...chunks.map((chunk, index) => `## Part ${index + 1}\n\n${chunk}`),
      '',
      '---',
      '',
      `${INSTRUCTIONS[kind]} Reply with the merged summary only.`,
    ].join('\n'),
  }
  return { messages: [{ role: 'system', content: MERGE_INSTRUCTION }, partialsPrompt], temperature: 0.2 }
}

function directPrompt(chunk: string, kind: SummaryKind, articleTitle?: string): ChatMessage {
  return {
    role: 'user',
    content: [
      articleTitle ? `# ${articleTitle}` : '# Document',
      '',
      chunk,
      '',
      '---',
      '',
      INSTRUCTIONS[kind],
    ].join('\n'),
  }
}

function splitMarkdown(markdown: string, maxChars: number): string[] {
  const text = markdown.trim()
  if (text.length <= maxChars) return [text]
  const chunks: string[] = []
  let cursor = 0
  while (cursor < text.length) {
    const end = Math.min(text.length, cursor + maxChars)
    let breakAt = end
    if (end < text.length) {
      const candidate = text.lastIndexOf('\n\n', end)
      if (candidate > cursor + maxChars / 2) breakAt = candidate
    }
    chunks.push(text.slice(cursor, breakAt).trim())
    cursor = breakAt
  }
  return chunks.filter(chunk => chunk.length > 0)
}

export function summaryKindLabel(kind: SummaryKind): string {
  switch (kind) {
    case 'one-sentence': return '一句话摘要'
    case 'short': return '简短摘要'
    case 'detailed': return '详细摘要'
    case 'key-points': return '核心观点'
  }
}
