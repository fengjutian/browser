import { Empty, Input, List, Space, Tag, Typography } from 'antd'
import { FileSearchOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { PageHeader } from '../../shared/components/PageHeader'
import { DocumentDetailDrawer } from '../../features/documents/DocumentDetailDrawer'
import { listDocuments } from '../../api'
import type { Document } from '../../types'
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue'

export function SearchPage() {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 250)
  const [results, setResults] = useState<Document[]>([])
  const [selected, setSelected] = useState<Document | null>(null)
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let current = true
    setLoading(true)
    void listDocuments(debouncedQuery)
      .then(items => { if (current) { setResults(items); setUnavailable(false) } })
      .catch(() => { if (current) { setResults([]); setUnavailable(true) } })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [debouncedQuery])

  const emptyText = unavailable ? '本地数据服务未连接' : query ? '没有匹配的真实浏览内容' : '暂无浏览数据，请先保存网页到知识库'
  return <section className="page"><PageHeader eyebrow="FTS5 SEARCH" title="找回你读过的内容" description="搜索保存在本地 SQLite 中的真实网页内容。"/><Input size="large" prefix={<SearchOutlined/>} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、正文或标签" suffix={`${results.length} 条结果`}/><List loading={loading} className="search-results" dataSource={results} locale={{ emptyText: <Empty description={emptyText}/> }} renderItem={item => <List.Item onClick={() => setSelected(item)} className="search-result-clickable" actions={[<RightOutlined key="open"/>]}><List.Item.Meta avatar={<span className="result-icon"><FileSearchOutlined/></span>} title={item.title} description={<><Space size={4}>{item.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</Space><Typography.Paragraph>{item.summary ?? item.markdown}</Typography.Paragraph><Typography.Text type="secondary">{item.source || hostname(item.url)} · {item.url}</Typography.Text></>}/></List.Item>}/><DocumentDetailDrawer document={selected} onClose={() => setSelected(null)} onDeleted={id => setResults(items => items.filter(item => item.id !== id))}/></section>
}

function hostname(url: string) { try { return new URL(url).hostname } catch { return url } }
