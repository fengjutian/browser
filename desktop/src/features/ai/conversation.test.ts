import { describe, expect, it } from 'vitest'
import { compactChatHistory, parseStoredConversation } from './conversation'

describe('AI conversation persistence', () => {
  it('rejects corrupt entries and caps restored history', () => {
    const raw = JSON.stringify([{ id:'1', role:'user', content:'hello' }, { bad:true }])
    expect(parseStoredConversation(raw)).toEqual([{ id:'1', role:'user', content:'hello' }])
    expect(parseStoredConversation('{bad')).toEqual([])
  })

  it('keeps the newest complete messages within the context budget', () => {
    const result = compactChatHistory([
      { role:'user', content:'old-old' },
      { role:'assistant', content:'middle' },
      { role:'user', content:'latest' },
    ], 12)
    expect(result).toEqual([{ role:'user', content:'latest' }])
  })

  it('truncates an oversized latest message from the front', () => {
    expect(compactChatHistory([{ role:'user', content:'123456789' }], 4)).toEqual([{ role:'user', content:'6789' }])
  })
})
