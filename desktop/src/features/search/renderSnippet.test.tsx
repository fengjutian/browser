import { describe, expect, it } from 'vitest'
import { renderHighlightedSnippet } from './renderSnippet'

describe('renderHighlightedSnippet', () => {
  it('returns null for empty or missing input', () => {
    expect(renderHighlightedSnippet(null)).toBeNull()
    expect(renderHighlightedSnippet(undefined)).toBeNull()
    expect(renderHighlightedSnippet('')).toBeNull()
  })

  it('renders plain text without marks', () => {
    const out = renderHighlightedSnippet('Rust async runtime guide') as unknown as { props: { children: unknown } }[]
    expect(Array.isArray(out)).toBe(true)
    expect(out).toHaveLength(1)
    expect(out[0].props.children).toBe('Rust async runtime guide')
  })

  it('wraps marked segments in <mark> elements', () => {
    const nodes = renderHighlightedSnippet('The <mark>tokio</mark> runtime drives Rust futures') as unknown as Array<{
      type: string
      props: { children: string }
    }>
    expect(Array.isArray(nodes)).toBe(true)
    expect(nodes).toHaveLength(3)
    expect(nodes[0].type).not.toBe('mark')
    expect(nodes[0].props.children).toBe('The ')
    expect(nodes[1].type).toBe('mark')
    expect(nodes[1].props.children).toBe('tokio')
    expect(nodes[2].type).not.toBe('mark')
    expect(nodes[2].props.children).toBe(' runtime drives Rust futures')
  })

  it('ignores nested HTML and keeps <mark> boundaries strict', () => {
    const nodes = renderHighlightedSnippet('alpha <mark>beta</mark> gamma <script>alert(1)</script>') as unknown as Array<{
      type: string
      props: { children: string }
    }>
    expect(nodes).toHaveLength(3)
    expect(nodes[0].type).not.toBe('mark')
    expect(nodes[0].props.children).toBe('alpha ')
    expect(nodes[1].type).toBe('mark')
    expect(nodes[1].props.children).toBe('beta')
    expect(nodes[2].props.children).toBe(' gamma <script>alert(1)</script>')
  })
})