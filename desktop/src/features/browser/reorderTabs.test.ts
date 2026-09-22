import { describe, expect, it } from 'vitest'
import { reorderTabs } from './reorderTabs'

describe('reorderTabs', () => {
  it('moves an item forward', () => {
    expect(reorderTabs(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves an item backward', () => {
    expect(reorderTabs(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('returns a same-content array when from === to', () => {
    const source = ['a', 'b', 'c']
    const result = reorderTabs(source, 1, 1)
    expect(result).toEqual(source)
    expect(result).not.toBe(source)
  })

  it('returns a copy unchanged when indices are invalid', () => {
    const source = ['a', 'b', 'c']
    expect(reorderTabs(source, -1, 2)).toEqual(source)
    expect(reorderTabs(source, 5, 0)).toEqual(source)
    expect(reorderTabs(source, 0, 99)).toEqual(source)
  })

  it('does not mutate the source array', () => {
    const source = ['a', 'b', 'c']
    reorderTabs(source, 0, 2)
    expect(source).toEqual(['a', 'b', 'c'])
  })

  it('handles single-item arrays', () => {
    expect(reorderTabs(['only'], 0, 0)).toEqual(['only'])
  })

  it('handles empty arrays', () => {
    expect(reorderTabs<string>([], 0, 0)).toEqual([])
  })
})