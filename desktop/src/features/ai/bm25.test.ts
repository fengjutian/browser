import { describe, expect, it } from 'vitest'
import { rankByBm25, tokenize } from './bm25'

describe('tokenize', () => {
  it('lowercases English words and digits', () => {
    expect(tokenize('Hello World 2024')).toEqual(['hello', 'world', '2024'])
  })

  it('splits Chinese text into bigrams', () => {
    expect(tokenize('你好世界')).toEqual(['你好', '好世', '世界'])
  })

  it('handles mixed CJK and English', () => {
    const tokens = tokenize('React 组件设计模式')
    expect(tokens).toContain('react')
    expect(tokens).toContain('组件')
    expect(tokens).toContain('件设')
    expect(tokens).toContain('设计')
    expect(tokens).toContain('模式')
  })

  it('drops punctuation and whitespace', () => {
    expect(tokenize('  hello,   world!  ')).toEqual(['hello', 'world'])
  })

  it('returns empty array for empty / punctuation-only input', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('!!! ...')).toEqual([])
  })
})

interface Sample {
  id: string
  body: string
}

describe('rankByBm25', () => {
  const docs: Sample[] = [
    { id: 'sqlite', body: 'SQLite 是一个轻量级嵌入式关系数据库,支持事务和 FTS5 全文索引。' },
    { id: 'react', body: 'React 组件设计模式:状态提升、受控组件、组合优于继承。' },
    { id: 'tauri', body: 'Tauri 2 使用系统 WebView 构建桌面应用,Rust 后端负责权限和原生命令。' },
    { id: 'bm25', body: 'BM25 是一种基于词频和文档频率的排序算法,常用于全文检索。' },
  ]

  it('ranks the database-related document highest for "数据库" query', () => {
    const ranked = rankByBm25('数据库 事务', docs, d => d.body)
    expect(ranked[0].document.id).toBe('sqlite')
    expect(ranked[0].originalIndex).toBe(0)
    expect(ranked[0].score).toBeGreaterThan(0)
  })

  it('ranks the BM25 document highest for English query "BM25 ranking"', () => {
    const ranked = rankByBm25('BM25 ranking algorithm', docs, d => d.body)
    expect(ranked[0].document.id).toBe('bm25')
  })

  it('produces zero score for documents that share no tokens with the query', () => {
    const ranked = rankByBm25('xyz123nonexistent', docs, d => d.body)
    for (const entry of ranked) expect(entry.score).toBe(0)
  })

  it('preserves originalIndex so citations can be mapped back', () => {
    const reordered = [docs[3], docs[0], docs[1], docs[2]]
    const ranked = rankByBm25('数据库', reordered, d => d.body)
    const sqlite = ranked.find(r => r.document.id === 'sqlite')
    expect(sqlite?.originalIndex).toBe(1)
  })

  it('handles empty document list', () => {
    expect(rankByBm25('anything', [] as Sample[], d => d.body)).toEqual([])
  })

  it('returns zero scores when query has no tokens', () => {
    const ranked = rankByBm25('!!! ???', docs, d => d.body)
    for (const entry of ranked) expect(entry.score).toBe(0)
  })
})
