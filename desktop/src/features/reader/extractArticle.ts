import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import type { PageSnapshot, ReaderArticle } from './types'

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
turndown.addRule('removeScripts', { filter: ['script', 'style', 'noscript'], replacement: () => '' })

export function extractArticle(snapshot: PageSnapshot): ReaderArticle {
  const document = new DOMParser().parseFromString(snapshot.html, 'text/html')
  const base = document.createElement('base')
  base.href = snapshot.url
  document.head.prepend(base)
  const article = new Readability(document, { keepClasses: false }).parse()
  if (!article?.content || !article.textContent.trim()) throw new Error('reader_content_not_found')
  const content = new DOMParser().parseFromString(article.content, 'text/html')
  content.querySelectorAll<HTMLElement>('[src],[href]').forEach(element => {
    for (const attribute of ['src', 'href']) {
      const value = element.getAttribute(attribute)
      if (value) try { element.setAttribute(attribute, new URL(value, snapshot.url).toString()) } catch { /* preserve invalid source value */ }
    }
  })
  const contentHtml = content.body.innerHTML
  return { title: article.title.trim(), byline: article.byline?.trim() ?? '', excerpt: article.excerpt?.trim() ?? '', siteName: article.siteName?.trim() ?? '', language: article.lang?.trim() ?? '', contentHtml, markdown: turndown.turndown(contentHtml), textContent: article.textContent.trim(), wordCount: article.textContent.trim().split(/\s+/u).filter(Boolean).length }
}
