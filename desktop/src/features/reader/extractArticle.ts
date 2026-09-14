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
  const textContent = article?.textContent?.trim() ?? ''
  if (!article?.content || !textContent) throw new Error('reader_content_not_found')
  const content = new DOMParser().parseFromString(article.content, 'text/html')
  content.querySelectorAll('script,style,noscript,iframe,object,embed,form').forEach(element => element.remove())
  content.querySelectorAll<HTMLElement>('*').forEach(element => {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.toLowerCase().startsWith('on')) element.removeAttribute(attribute.name)
    }
  })
  content.querySelectorAll<HTMLElement>('[src],[href]').forEach(element => {
    for (const attribute of ['src', 'href']) {
      const value = element.getAttribute(attribute)
      if (value) try { const resolved=new URL(value,snapshot.url);if(['http:','https:'].includes(resolved.protocol))element.setAttribute(attribute,resolved.toString());else element.removeAttribute(attribute) } catch { element.removeAttribute(attribute) }
    }
  })
  const contentHtml = content.body.innerHTML
  return { title: article.title?.trim() ?? '', byline: article.byline?.trim() ?? '', excerpt: article.excerpt?.trim() ?? '', siteName: article.siteName?.trim() ?? '', language: article.lang?.trim() ?? '', contentHtml, markdown: turndown.turndown(contentHtml), textContent, wordCount: textContent.split(/\s+/u).filter(Boolean).length }
}
