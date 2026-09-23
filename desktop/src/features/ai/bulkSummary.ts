import { extractArticle } from '../reader/extractArticle'
import type { ReaderArticle } from '../reader/types'
import { buildSummaryPrompt, summaryKindLabel, type SummaryKind } from './summarize'

export interface BulkSummaryInput {
  providerId: string
  urls: string[]
  kind: SummaryKind
  /** Called for every successful fetch + save. */
  onProgress?: (entry: BulkProgressEntry) => void
}

export interface BulkProgressEntry {
  index: number
  total: number
  url: string
  title: string
  status: 'fetched' | 'summarised' | 'skipped' | 'failed'
  documentId?: string
  message?: string
}

export interface BulkSummaryResult {
  entries: BulkProgressEntry[]
  aggregatedTitle: string
  aggregatedSummary: string
}

/**
 * Fetch + summarise a list of URLs in one pass. Each URL is fetched, parsed
 * via the reader, summarised via the AI provider, and written to the
 * documents database. The caller can subscribe to per-URL progress.
 *
 * The aggregated cross-URL summary is returned to the UI so it can either be
 * displayed inline or saved as a separate `multi-summary` document.
 */
export async function summariseUrls(
  input: BulkSummaryInput,
  deps: {
    fetchHtml: (url: string) => Promise<string>
    summariseMarkdown: (markdown: string, title: string, kind: SummaryKind) => Promise<string>
    saveDocument: (record: { title: string; url: string; markdown: string; tags: string[] }) => Promise<{ id: string; title: string }>
    crossSummarise: (titles: string[], partials: string[], kind: SummaryKind) => Promise<string>
  },
): Promise<BulkSummaryResult> {
  const entries: BulkProgressEntry[] = []
  const titles: string[] = []
  const partials: string[] = []
  for (let index = 0; index < input.urls.length; index += 1) {
    const url = input.urls[index]!
    try {
      const html = await deps.fetchHtml(url)
      const article: ReaderArticle = extractArticle({ url, html })
      if (!article.markdown?.trim()) {
        const entry: BulkProgressEntry = { index, total: input.urls.length, url, title: url, status: 'skipped', message: '正文为空' }
        entries.push(entry)
        input.onProgress?.(entry)
        continue
      }
      const summary = await deps.summariseMarkdown(article.markdown, article.title || url, input.kind)
      const document = await deps.saveDocument({
        title: `摘要：${article.title || url}`,
        url,
        markdown: `# ${article.title}\n\n来源：${url}\n\n## 摘要\n\n${summary}\n\n## 正文\n\n${article.markdown}`,
        tags: ['bulk-summary', input.kind],
      })
      const entry: BulkProgressEntry = { index, total: input.urls.length, url, title: article.title, status: 'summarised', documentId: document.id }
      entries.push(entry)
      input.onProgress?.(entry)
      titles.push(article.title)
      partials.push(summary)
    } catch (error) {
      const entry: BulkProgressEntry = { index, total: input.urls.length, url, title: url, status: 'failed', message: String(error) }
      entries.push(entry)
      input.onProgress?.(entry)
    }
  }
  let aggregatedSummary = ''
  if (titles.length) {
    try {
      aggregatedSummary = await deps.crossSummarise(titles, partials, input.kind)
    } catch (error) {
      aggregatedSummary = partials.join('\n\n---\n\n')
    }
  }
  const aggregatedTitle = titles.length > 1 ? `多链接综述（${titles.length} 条）` : titles[0] ?? '多链接综述'
  return { entries, aggregatedTitle, aggregatedSummary }
}

export function summaryKindLabelSafe(kind: SummaryKind): string {
  return summaryKindLabel(kind)
}