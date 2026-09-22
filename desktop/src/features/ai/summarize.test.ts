import { describe, expect, it } from 'vitest'
import { buildSummaryPrompt, summaryKindLabel } from './summarize'

describe('buildSummaryPrompt', () => {
  it('returns a single user message for short articles', () => {
    const request = buildSummaryPrompt('Hello world.', 'short', 'Title')
    expect(request.messages).toHaveLength(1)
    expect(request.messages[0].content).toContain('# Title')
    expect(request.messages[0].content).toContain('Hello world.')
  })

  it('uses a merge prompt when the article must be chunked', () => {
    const longMarkdown = Array.from({ length: 500 }, (_, index) => `paragraph ${index} ${'lorem ipsum '.repeat(60)}`).join('\n\n')
    const request = buildSummaryPrompt(longMarkdown, 'detailed', 'Big Article')
    expect(request.messages.length).toBeGreaterThan(1)
    expect(request.messages[0].role).toBe('system')
    expect(request.messages.some(message => message.content.includes('Part 1'))).toBe(true)
  })

  it('rejects hallucination: instructions forbid invented facts', () => {
    const request = buildSummaryPrompt('Body.', 'key-points')
    expect(request.messages.some(message => message.content.includes('bullet'))).toBe(true)
  })
})

describe('summaryKindLabel', () => {
  it('maps every SummaryKind to a Chinese label', () => {
    expect(summaryKindLabel('one-sentence')).toBe('一句话摘要')
    expect(summaryKindLabel('short')).toBe('简短摘要')
    expect(summaryKindLabel('detailed')).toBe('详细摘要')
    expect(summaryKindLabel('key-points')).toBe('核心观点')
  })
})
