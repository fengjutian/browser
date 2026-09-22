import type { ChatRequest } from '../../types'

const SYSTEM_PROMPT = [
  'You tag a saved document for a personal knowledge base.',
  'Tags are short, lowercase, kebab-case keywords (1-3 words).',
  'Prefer reusing tags from the existing vocabulary; only invent a new tag when no existing one fits.',
  'Output a JSON array of strings only, e.g. ["frontend", "rfc"].',
  'Never output prose, explanations, or duplicates.',
].join(' ')

export const MAX_TAGS = 6

export interface AutoTagInput {
  markdown: string
  existingTags: string[]
  title?: string
}

export interface AutoTagOptions {
  maxTags?: number
  minConfidence?: number
}

export function buildAutoTagPrompt({ markdown, existingTags, title }: AutoTagInput, options: AutoTagOptions = {}): ChatRequest {
  const max = options.maxTags ?? MAX_TAGS
  const existing = existingTags.length > 0 ? existingTags.join(', ') : '(none)'
  const excerpt = markdown.length > 2400 ? `${markdown.slice(0, 2400)}\n\n[…truncated]` : markdown
  const userMessage = [
    title ? `# ${title}` : '# Document',
    '',
    excerpt,
    '',
    '---',
    '',
    `Existing tag vocabulary: ${existing}`,
    `Return up to ${max} tags as a JSON array.`,
  ].join('\n')
  return { messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage }], temperature: 0.1 }
}

export function normalizeTag(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-\p{L}\p{N}_]/gu, '')
  if (!trimmed) return null
  if (trimmed.length > 32) return null
  return trimmed
}

export function parseAutoTagResponse(raw: string, options: AutoTagOptions = {}): string[] {
  const max = options.maxTags ?? MAX_TAGS
  let parsed: unknown
  if (raw.trimStart().startsWith('[')) {
    try { parsed = JSON.parse(extractJsonArray(raw)) }
    catch { parsed = undefined }
  }
  if (!Array.isArray(parsed)) {
    const matches = Array.from(raw.matchAll(/"([\p{L}\p{N}_\-\s]{1,32})"/gu))
    if (matches.length === 0) return []
    parsed = matches.map(match => match[1])
  }
  const candidates: unknown[] = Array.isArray(parsed) ? parsed : []
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const tag = normalizeTag(candidate)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    result.push(tag)
    if (result.length >= max) break
  }
  return result
}

export function mergeAutoTags(existing: string[], generated: string[], rejected: string[] = [], options: AutoTagOptions = {}): string[] {
  const max = options.maxTags ?? MAX_TAGS
  const rejectedSet = new Set(rejected.map(normalizeTag).filter(Boolean) as string[])
  const seen = new Set<string>()
  const merged: string[] = []
  for (const candidate of [...generated, ...existing]) {
    const tag = normalizeTag(candidate)
    if (!tag || rejectedSet.has(tag) || seen.has(tag)) continue
    seen.add(tag)
    merged.push(tag)
    if (merged.length >= max) break
  }
  return merged
}

function extractJsonArray(raw: string): string {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return '[]'
  return raw.slice(start, end + 1)
}
