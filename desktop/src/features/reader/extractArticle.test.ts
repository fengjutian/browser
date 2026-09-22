import { describe, expect, it } from 'vitest'
import { extractArticle } from './extractArticle'
import type { PageSnapshot } from './types'

const snapshot = (url: string, html: string): PageSnapshot => ({ url, html })

const ARTICLE_BODY =
  'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores.'

const articleWith = (intro: string, extras: string) => `
  <html>
    <head><title>Sample Article</title></head>
    <body><article>
      <h1>Sample Article</h1>
      <p>${intro} ${ARTICLE_BODY}</p>
      ${extras}
      <p>Second paragraph with additional body copy to push the article past Readability heuristics and ensure the main content node is selected by the parser for downstream markdown conversion.</p>
    </article></body>
  </html>
`

describe('extractArticle', () => {
  it('throws reader_content_not_found when article body is empty', () => {
    const empty = snapshot(
      'https://example.com/',
      '<html><head><title>x</title></head><body></body></html>',
    )
    expect(() => extractArticle(empty)).toThrow('reader_content_not_found')
  })

  it('strips script and iframe elements from extracted content', () => {
    const article = extractArticle(
      snapshot(
        'https://example.com/article',
        articleWith(
          'Hello world',
          '<p>Inline paragraph <script>alert(1)</script> and <iframe src="https://evil.example/"></iframe> with more body text so Readability keeps the surrounding paragraph node.</p>',
        ),
      ),
    )
    expect(article.contentHtml.toLowerCase()).not.toMatch(/<script\b/)
    expect(article.contentHtml.toLowerCase()).not.toMatch(/<iframe\b/)
    expect(article.markdown).toContain('Hello world')
  })

  it('removes on* event handler attributes from every element', () => {
    const html = articleWith(
      'Inline handler',
      '<p onclick="alert(1)">P tag with handler and body text.</p><img src="/cat.png" onerror="alert(1)" alt="cat"/>',
    )
    const article = extractArticle(snapshot('https://example.com/', html))
    expect(article.contentHtml.toLowerCase()).not.toMatch(/\son[a-z]+\s*=/)
  })

  it('drops dangerous protocols from href and src', () => {
    const html = articleWith(
      'Protocol drop',
      '<p>Mixed links: <a href="javascript:alert(1)">js</a>, <a href="data:text/html,&lt;h1&gt;x&lt;/h1&gt;">data</a>, and <a href="https://safe.example/path">safe</a> plus <img src="file:///etc/passwd" alt="file"/> with extra body text to keep the paragraph alive.</p>',
    )
    const article = extractArticle(snapshot('https://example.com/', html))
    const lowered = article.contentHtml.toLowerCase()
    expect(lowered).not.toContain('javascript:')
    expect(lowered).not.toContain('data:text/html')
    expect(lowered).not.toContain('file:///')
    expect(lowered).toContain('safe.example')
  })

  it('resolves relative URLs against snapshot.url via the injected base element', () => {
    const html = articleWith(
      'Relative links',
      '<p>See <a href="/path/page.html">relative</a> and <a href="../other">sibling</a> for more body text here.</p>',
    )
    const article = extractArticle(snapshot('https://example.com/foo/bar/', html))
    expect(article.contentHtml).toContain('https://example.com/path/page.html')
    expect(article.contentHtml).toContain('https://example.com/foo/other')
  })

  it('produces markdown with the body text', () => {
    const article = extractArticle(snapshot('https://example.com/', articleWith('Body text', '')))
    expect(article.markdown).toContain('Body text')
    expect(article.markdown.length).toBeGreaterThan(0)
    expect(article.wordCount).toBeGreaterThan(0)
  })
})