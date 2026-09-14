import { Empty, Input, List, Space, Tag, Typography } from 'antd'
import { FileSearchOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { PageHeader } from '../../shared/components/PageHeader'
import { demoDocuments } from '../../mock'
import { listDocuments } from '../../api'
import type { Document } from '../../types'

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Document[]>(demoDocuments)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true)
      void listDocuments(query).then(setResults).catch(() => {
        const normalized = query.toLowerCase()
        setResults(demoDocuments.filter(item => `${item.title} ${item.summary} ${item.tags.join(' ')}`.toLowerCase().includes(normalized)))
      }).finally(() => setLoading(false))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query])
  return <section className="page"><PageHeader eyebrow="FTS5 SEARCH" title="找回你读过的内容" description="由本地 SQLite 全文索引驱动，后端离线时自动使用演示数据。"/><Input size="large" prefix={<SearchOutlined/>} value={query} onChange={event=>setQuery(event.target.value)} placeholder="试试“Tauri 安全”或“Agent 权限”" suffix={`${results.length} 条结果`}/><List loading={loading} className="search-results" dataSource={results} locale={{emptyText:<Empty description="没有匹配内容"/>}} renderItem={item=><List.Item actions={[<RightOutlined key="open"/>]}><List.Item.Meta avatar={<span className="result-icon"><FileSearchOutlined/></span>} title={item.title} description={<><Space size={4}>{item.tags.map(tag=><Tag key={tag}>{tag}</Tag>)}</Space><Typography.Paragraph>{item.summary ?? item.markdown}</Typography.Paragraph><Typography.Text type="secondary">{item.source} · {item.url}</Typography.Text></>}/></List.Item>}/></section>
}
