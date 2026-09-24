import { Typography } from '../../components/ui'
import type { ReaderArticle } from '../reader/types'

export function ReaderArticleView({ article }: { article: ReaderArticle }) {
  return <article className="reader-document">
    <Typography.Text className="eyebrow">阅读模式 · {article.wordCount.toLocaleString()} 字词</Typography.Text>
    <Typography.Title>{article.title}</Typography.Title>
    {article.byline && <Typography.Text type="secondary">{article.byline}</Typography.Text>}
    <div className="reader-document__body" dangerouslySetInnerHTML={{ __html: article.contentHtml }} />
  </article>
}
