import { Button, Empty, Input, List, Modal, Segmented, Select, Space, Statistic, Tag, Typography } from '../../components/ui'
import { FileSearchOutlined, RightOutlined, SearchOutlined } from '../../components/ui/icons'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../shared/components/PageHeader'
import { DocumentDetailDrawer } from '../../features/documents/DocumentDetailDrawer'
import { deleteReadingSnapshot, searchDocuments, listReadingActivity, getSession, setSession, type DocumentSearchHit } from '../../api'
import type { ReadingActivity } from '../../types'
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue'
import { renderHighlightedSnippet } from '../../features/search/renderSnippet'

type SortKey = 'recent' | 'oldest' | 'starred' | 'relevance'

export function SearchPage({ initialQuery = '', onOpenUrl }: { initialQuery?: string; onOpenUrl?: (url: string) => void }) {
  const [query, setQuery] = useState(initialQuery)
  const debouncedQuery = useDebouncedValue(query, 250)
  const [documents, setDocuments] = useState<DocumentSearchHit[]>([])
  const [reading, setReading] = useState<ReadingActivity[]>([])
  const [selected, setSelected] = useState<DocumentSearchHit | null>(null)
  const [selectedReading, setSelectedReading] = useState<ReadingActivity | null>(null)
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [starredOnly, setStarredOnly] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [sort, setSort] = useState<SortKey>('recent')
  const [readOnly, setReadOnly] = useState(false)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [recentQueries, setRecentQueries] = useState<string[]>([])

  useEffect(() => {
    void getSession('search.recent').then(raw => {
      if (!raw) return
      try {
        const parsed = JSON.parse(raw) as string[]
        if (Array.isArray(parsed)) setRecentQueries(parsed.filter(value => typeof value === 'string').slice(0, 10))
      } catch { /* ignore corrupt session */ }
    })
  }, [])

  const rememberQuery = useCallback((value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setRecentQueries(prev => {
      const next = [trimmed, ...prev.filter(item => item !== trimmed)].slice(0, 10)
      void setSession('search.recent', JSON.stringify(next))
      return next
    })
  }, [])

  useEffect(() => {
    if (debouncedQuery) rememberQuery(debouncedQuery)
    // rememberQuery is excluded so we don't re-run on every list mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery])

  useEffect(() => {
    if (initialQuery && initialQuery !== query) setQuery(initialQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery])

  useEffect(() => {
    let current = true
    setLoading(true)
    const startedAt = performance.now()
    void Promise.all([searchDocuments(debouncedQuery), listReadingActivity()])
      .then(([items, activity]) => {
        if (!current) return
        setDocuments(items)
        setReading(activity)
        setUnavailable(false)
        setDurationMs(Math.round(performance.now() - startedAt))
      })
      .catch(() => { if (current) { setDocuments([]); setUnavailable(true) } })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [debouncedQuery])

  const readingByUrl = useMemo(() => new Map(reading.map(item => [item.url, item])), [reading])

  const unsavedReading = useMemo(() => {
    const savedUrls = new Set(documents.map(item => item.url))
    const lower = debouncedQuery.toLowerCase()
    return reading.filter(item => {
      if (savedUrls.has(item.url) || readingStatus(item) === 'seen') return false
      if (!lower) return true
      return item.title.toLowerCase().includes(lower) || item.url.toLowerCase().includes(lower) || (item.markdown ?? '').toLowerCase().includes(lower)
    })
  }, [documents, reading, debouncedQuery])

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
        if (readOnly && readingStatus(readingByUrl.get(doc.url)) === 'seen') return false
        if (!includeArchived && doc.status === 'ARCHIVED') return false
        if (tagFilter.length > 0 && !tagFilter.every(tag => doc.tags.includes(tag))) return false
        if (!lower) return true
        return [doc.title, doc.summary ?? '', doc.markdown ?? '', doc.tags.join(' ')].some(field => field.toLowerCase().includes(lower))
      })
      .sort((a, b) => {
        if (sort === 'starred') return Number(b.starred) - Number(a.starred) || b.createdAt.localeCompare(a.createdAt)
        if (sort === 'oldest') return a.createdAt.localeCompare(b.createdAt)
        if (sort === 'relevance' && a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank
        return (readingByUrl.get(b.url)?.lastVisitedAt ?? Date.parse(b.createdAt) / 1000) - (readingByUrl.get(a.url)?.lastVisitedAt ?? Date.parse(a.createdAt) / 1000)
      })
  }, [documents, debouncedQuery, starredOnly, includeArchived, tagFilter, sort, readOnly, readingByUrl])

  useEffect(() => { /* filtered is consumed directly by the List dataSource */ }, [filtered])

  const terms = useMemo(() => debouncedQuery.trim().split(/\s+/).filter(Boolean), [debouncedQuery])
  const emptyText = unavailable
    ? '本地数据服务未连接'
    : debouncedQuery
      ? '没有匹配的真实浏览内容'
      : '暂无浏览数据，请先保存网页到知识库'

  return <section className="page"><PageHeader eyebrow="LOCAL SEARCH" title="找回你读过的内容" description="搜索保存在本地 SQLite 中的真实网页内容。"/><Input size="large" prefix={<SearchOutlined/>} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、正文或标签" suffix={`${filtered.length} 条结果${durationMs !== null ? ` · ${durationMs}ms` : ''}`}/>
    {recentQueries.length > 0 && !debouncedQuery && (
      <Space wrap className="search-history">
        <span className="search-history-label">最近：</span>
        {recentQueries.slice(0, 8).map(item => (
          <Tag key={item} className="search-history-chip" onClick={() => setQuery(item)}>{item}</Tag>
        ))}
      </Space>
    )}
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
      <Segmented value={readOnly ? 'read' : 'all'} onChange={value => setReadOnly(value === 'read')} options={[{label:'全部内容',value:'all'},{label:'确实读过',value:'read'}]}/>
      <Segmented value={includeArchived ? 'all' : 'active'} onChange={value => setIncludeArchived(value === 'all')} options={[{label:'未归档',value:'active'},{label:'含归档',value:'all'}]}/>
      <Segmented value={sort} onChange={value => setSort(value as SortKey)} options={debouncedQuery ? [{label:'相关度',value:'relevance'},{label:'最新',value:'recent'},{label:'最早',value:'oldest'},{label:'收藏优先',value:'starred'}] : [{label:'最新',value:'recent'},{label:'最早',value:'oldest'},{label:'收藏优先',value:'starred'}]}/>
      {durationMs !== null && <Statistic title="耗时" value={durationMs} suffix="ms" valueStyle={{fontSize:14}}/>}
    </Space>
    <List loading={loading} className="search-results" dataSource={filtered} locale={{ emptyText: unsavedReading.length ? null : <Empty description={emptyText}/> }} renderItem={item => { const activity=readingByUrl.get(item.url); const titleNode = (item.titleSnippet && terms.length > 0) ? renderHighlightedSnippet(item.titleSnippet) ?? item.title : item.title; const summaryText = item.markdownSnippet || item.summarySnippet || extractSummary(item.summary, item.markdown); return <List.Item onClick={() => setSelected(item)} className="search-result-clickable" actions={[<RightOutlined key="open"/>]}><List.Item.Meta avatar={<span className="result-icon"><FileSearchOutlined/></span>} title={<>{titleNode}{item.rank !== undefined && terms.length > 0 && <Tag className="search-rank">rank {item.rank.toFixed(2)}</Tag>}</>} description={<><Space size={4}>{item.tags.map(tag => <Tag className={tagFilter.includes(tag) ? 'search-tag is-active' : 'search-tag'} key={tag}>{tag}</Tag>)}{activity && <Tag color={readingStatus(activity)==='deep'?'green':'blue'}>{readingLabel(activity)}</Tag>}</Space><Typography.Paragraph ellipsis={{ rows: 2, expandable: false }}>{(item.markdownSnippet || item.summarySnippet) ? renderHighlightedSnippet(item.markdownSnippet || item.summarySnippet) : <Highlight text={summaryText} terms={terms}/>}</Typography.Paragraph></>}/></List.Item> }}/>
    {unsavedReading.length > 0 && <><Typography.Title level={4}>读过但未保存</Typography.Title><List className="search-results" dataSource={unsavedReading} renderItem={item => <List.Item onClick={() => item.markdown ? setSelectedReading(item) : onOpenUrl?.(item.url)} className="search-result-clickable" actions={[<RightOutlined key="open"/>]}><List.Item.Meta avatar={<span className="result-icon"><SearchOutlined/></span>} title={<Highlight text={item.title || item.url} terms={terms}/>} description={<><Space size={4}><Tag color={readingStatus(item)==='deep'?'green':'blue'}>{readingLabel(item)}</Tag><Tag>{item.markdown ? '正文快照' : '未保存'}</Tag></Space><Typography.Paragraph ellipsis={{ rows: 2, expandable: false }}><Highlight text={item.excerpt || item.url} terms={terms}/></Typography.Paragraph></>}/></List.Item>}/></>}
    <Modal open={selectedReading !== null} title={selectedReading?.title || '阅读快照'} footer={<Space><Button danger onClick={() => { const url=selectedReading?.url;if(!url)return;void deleteReadingSnapshot(url).then(()=>{setReading(items=>items.map(item=>item.url===url?{...item,excerpt:undefined,markdown:undefined,capturedAt:undefined}:item));setSelectedReading(null)}) }}>删除快照</Button><Button onClick={() => setSelectedReading(null)}>关闭</Button><Button type="primary" onClick={() => { const url=selectedReading?.url;setSelectedReading(null);if(url)onOpenUrl?.(url) }}>重新打开原网页</Button></Space>} width="min(900px, 90vw)" onCancel={() => setSelectedReading(null)} destroyOnHidden>{selectedReading && <><Typography.Paragraph type="secondary" copyable>{selectedReading.url}</Typography.Paragraph><Typography.Paragraph style={{whiteSpace:'pre-wrap',maxHeight:'65vh',overflow:'auto'}}>{selectedReading.markdown}</Typography.Paragraph></>}</Modal>
    <DocumentDetailDrawer document={selected} onClose={() => setSelected(null)} onDeleted={id => setDocuments(items => items.filter(item => item.id !== id))}/>
  </section>
}

function readingStatus(activity?: ReadingActivity): 'seen'|'read'|'deep' {
  if (!activity) return 'seen'
  if (activity.activeSeconds >= 120 || activity.maxScrollDepth >= .7) return 'deep'
  if (activity.activeSeconds >= 30 && activity.maxScrollDepth >= .2) return 'read'
  return 'seen'
}

function readingLabel(activity: ReadingActivity): string {
  const status = readingStatus(activity) === 'deep' ? '深度阅读' : readingStatus(activity) === 'read' ? '已阅读' : '浏览过'
  const duration = activity.activeSeconds >= 60 ? `${Math.floor(activity.activeSeconds / 60)}分${activity.activeSeconds % 60}秒` : `${activity.activeSeconds}秒`
  return `${status} · ${duration} · 滚动${Math.round(activity.maxScrollDepth * 100)}%`
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
