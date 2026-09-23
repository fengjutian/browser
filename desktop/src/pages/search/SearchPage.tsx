import { Empty, Input, List, Segmented, Select, Space, Statistic, Tag, Typography } from '../../components/ui'
import { FileSearchOutlined, RightOutlined, SearchOutlined } from '../../components/ui/icons'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../shared/components/PageHeader'
import { DocumentDetailDrawer } from '../../features/documents/DocumentDetailDrawer'
import { listDocuments } from '../../api'
import type { Document } from '../../types'
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue'

type SortKey = 'recent' | 'oldest' | 'starred'

export function SearchPage({ initialQuery = '' }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery)
  const debouncedQuery = useDebouncedValue(query, 250)
  const [documents, setDocuments] = useState<Document[]>([])
  const [selected, setSelected] = useState<Document | null>(null)
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [starredOnly, setStarredOnly] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [sort, setSort] = useState<SortKey>('recent')
  const [durationMs, setDurationMs] = useState<number | null>(null)

  useEffect(() => { setQuery(initialQuery) }, [initialQuery])

  useEffect(() => {
    let current = true
    setLoading(true)
    const startedAt = performance.now()
    void listDocuments(debouncedQuery)
      .then(items => {
        if (!current) return
        setDocuments(items)
        setUnavailable(false)
        setDurationMs(Math.round(performance.now() - startedAt))
      })
      .catch(() => { if (current) { setDocuments([]); setUnavailable(true) } })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [debouncedQuery])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    documents.forEach(doc => doc.tags.forEach(tag => set.add(tag)))
    return Array.from(set).sort()
  }, [documents])

  const filtered = useMemo(() => {
    const lower = debouncedQuery.toLowerCase()
    return documents
      .filter(doc => {
        if (starredOnly && !doc.starred) return false
        if (!includeArchived && doc.status === 'ARCHIVED') return false
        if (tagFilter.length > 0 && !tagFilter.every(tag => doc.tags.includes(tag))) return false
        if (!lower) return true
        return [doc.title, doc.summary ?? '', doc.markdown ?? '', doc.tags.join(' ')].some(field => field.toLowerCase().includes(lower))
      })
      .sort((a, b) => {
        if (sort === 'starred') return Number(b.starred) - Number(a.starred) || b.createdAt.localeCompare(a.createdAt)
        if (sort === 'oldest') return a.createdAt.localeCompare(b.createdAt)
        return b.createdAt.localeCompare(a.createdAt)
      })
  }, [documents, debouncedQuery, starredOnly, includeArchived, tagFilter, sort])

  useEffect(() => { /* filtered is consumed directly by the List dataSource */ }, [filtered])

  const terms = useMemo(() => debouncedQuery.trim().split(/\s+/).filter(Boolean), [debouncedQuery])
  const emptyText = unavailable
    ? '本地数据服务未连接'
    : debouncedQuery
      ? '没有匹配的真实浏览内容'
      : '暂无浏览数据，请先保存网页到知识库'

  return <section className="page"><PageHeader eyebrow="LOCAL SEARCH" title="找回你读过的内容" description="搜索保存在本地 SQLite 中的真实网页内容。"/><Input size="large" prefix={<SearchOutlined/>} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、正文或标签" suffix={`${filtered.length} 条结果${durationMs !== null ? ` · ${durationMs}ms` : ''}`}/>
    <Space wrap className="search-filters">
      <Select<string[]>
        mode="multiple"
        options={allTags.map(tag => ({label: tag, value: tag})) as any}
        style={{minWidth:160}}
        placeholder="按标签过滤"
        value={tagFilter}
        onChange={setTagFilter}
      />
      <Segmented value={starredOnly ? 'starred' : 'all'} onChange={value => setStarredOnly(value === 'starred')} options={[{label:'全部',value:'all'},{label:'仅收藏',value:'starred'}]}/>
      <Segmented value={includeArchived ? 'all' : 'active'} onChange={value => setIncludeArchived(value === 'all')} options={[{label:'未归档',value:'active'},{label:'含归档',value:'all'}]}/>
      <Segmented value={sort} onChange={value => setSort(value as SortKey)} options={[{label:'最新',value:'recent'},{label:'最早',value:'oldest'},{label:'收藏优先',value:'starred'}]}/>
      {durationMs !== null && <Statistic title="耗时" value={durationMs} suffix="ms" valueStyle={{fontSize:14}}/>}
    </Space>
    <List loading={loading} className="search-results" dataSource={filtered} locale={{ emptyText: <Empty description={emptyText}/> }} renderItem={item => <List.Item onClick={() => setSelected(item)} className="search-result-clickable" actions={[<RightOutlined key="open"/>]}><List.Item.Meta avatar={<span className="result-icon"><FileSearchOutlined/></span>} title={<Highlight text={item.title} terms={terms}/>} description={<><Space size={4}>{item.tags.map(tag => <Tag className={tagFilter.includes(tag) ? 'search-tag is-active' : 'search-tag'} key={tag}>{tag}</Tag>)}</Space><Typography.Paragraph ellipsis={{ rows: 2, expandable: false }}><Highlight text={extractSummary(item.summary, item.markdown)} terms={terms}/></Typography.Paragraph></>}/></List.Item>}/>
    <DocumentDetailDrawer document={selected} onClose={() => setSelected(null)} onDeleted={id => setDocuments(items => items.filter(item => item.id !== id))}/>
  </section>
}

function Highlight({text, terms}:{text:string;terms:string[]}) {
  if (!terms.length || !text) return <>{text}</>
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
  const parts = text.split(pattern)
  return <>{parts.map((part, index) => terms.some(term => part.toLowerCase() === term.toLowerCase()) ? <mark key={index} className="search-highlight">{part}</mark> : <Fragment key={index}>{part}</Fragment>)}</>
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function extractSummary(summary: string | undefined, markdown: string | undefined, max = 220): string {
  const raw = (summary && summary.trim()) || stripMarkdown(markdown || '')
  if (!raw) return ''
  const firstPara = raw.split(/\n{2,}/).find(p => p.trim().length > 0) ?? raw
  const collapsed = firstPara.replace(/\s*\n\s*/g, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max).trimEnd()}…` : collapsed
}

function stripMarkdown(md: string): string {
  return md
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>]+/g, '')
}
