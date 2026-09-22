import { describe, expect, it } from 'vitest'
import { buildAskPrompt, numberPassages, parseAnswer } from './ask'

describe('ask helpers', () => {
  it('assigns stable passage ids and skips empty segments', () => {
    const passages = numberPassages('First paragraph.\n\n\n\nSecond paragraph.\n\n   \n\nThird paragraph.')
    expect(passages.map(item => item.id)).toEqual(['p1', 'p2', 'p3'])
    expect(passages.map(item => item.text)).toEqual(['First paragraph.', 'Second paragraph.', 'Third paragraph.'])
  })

  it('builds a system prompt forbidding outside knowledge', () => {
    const request = buildAskPrompt('First paragraph.\n\nSecond paragraph.', 'When was it published?', 'Doc')
    expect(request.messages[0].role).toBe('system')
    expect(request.messages[0].content).toContain('ONLY the numbered passages')
    expect(request.messages[0].content).toContain('当前页面未提供相关信息')
    expect(request.messages[1].content).toContain('[p1] First paragraph.')
    expect(request.messages[1].content).toContain('When was it published?')
  })

  it('parses citations and dedupes', () => {
    const parsed = parseAnswer('It shipped in 2024 [p1]. Critics agreed [p2][p1].')
    expect(parsed.notFound).toBe(false)
    expect(parsed.citations).toEqual(['p1', 'p2'])
  })

  it('detects the not-found response', () => {
    const parsed = parseAnswer('当前页面未提供相关信息。')
    expect(parsed.notFound).toBe(true)
    expect(parsed.citations).toEqual([])
  })
})
