import { describe, expect, it } from 'vitest'
import { countTextUnits } from './textCount'

describe('countTextUnits', () => {
  it('counts Chinese characters individually', () => expect(countTextUnits('这是中文正文')).toBe(6))
  it('counts English tokens as words', () => expect(countTextUnits('Flutter golden test')).toBe(3))
  it('counts mixed text without punctuation', () => expect(countTextUnits('Flutter 原生测试，AI Agent!')).toBe(7))
  it('returns zero for whitespace and punctuation', () => expect(countTextUnits('  ，。！？ ')).toBe(0))
})
