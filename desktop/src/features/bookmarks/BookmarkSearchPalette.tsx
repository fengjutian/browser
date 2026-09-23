import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { List, Modal, Typography } from 'antd'
import { Button, Input, Tag, Tooltip, type InputRef } from '../../components/ui'
import { DeleteOutlined, StarFilled } from '@ant-design/icons'
import type { BookmarkRecord } from '../../services/bookmarks'
import { searchBookmarks, type BookmarkSearchResult } from './bookmarkSearchIndex'

export interface BookmarkSearchPaletteProps {
  open: boolean
  bookmarks: BookmarkRecord[]
  onClose: () => void
  onOpen: (bookmark: BookmarkRecord) => void
  onRemove: (bookmark: BookmarkRecord) => void
  onUpdate: (bookmark: BookmarkRecord, patch: { title?: string; folder?: string; note?: string }) => Promise<void> | void
}

function highlight(text: string, spans: ReadonlyArray<[number, number]>): ReactNode {
  if (!spans.length) return text
  const parts: ReactNode[] = []
  let cursor = 0
  for (const [start, end] of spans) {
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(<mark key={`${start}-${end}`}>{text.slice(start, end)}</mark>)
    cursor = end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

export function BookmarkSearchPalette({ open, bookmarks, onClose, onOpen, onRemove, onUpdate }: BookmarkSearchPaletteProps) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<any>(null)

  const rows = useMemo<BookmarkSearchResult[]>(() => searchBookmarks(query, bookmarks), [query, bookmarks])
  const current = rows[Math.min(highlight, Math.max(0, rows.length - 1))]

  useEffect(() => {
    if (!open) { setQuery(''); setHighlight(0); return }
    requestAnimationFrame(() => inputRef.current?.focus({ cursor: 'all' }))
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight(h => Math.min(h + 1, Math.max(0, rows.length - 1))) }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight(h => Math.max(0, h - 1)) }
      else if (event.key === 'Enter' && current) { event.preventDefault(); onOpen(current); onClose() }
      else if (event.key === 'Delete' && current) { event.preventDefault(); onRemove(current); setHighlight(h => Math.max(0, Math.min(h, rows.length - 2))) }
      else if (event.key.toLowerCase() === 'e' && current && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        const next = prompt('编辑标题', current.title)
        if (next && next.trim()) void onUpdate(current, { title: next.trim() })
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, rows, current, onOpen, onClose, onRemove, onUpdate])

  return <Modal
    open={open}
    footer={null}
    closable={false}
    destroyOnHidden
    width={680}
    onCancel={onClose}
    styles={{ body: { padding: 0 } }}
    title={null}
  >
    <div className="tab-search-palette">
      <Input
        ref={inputRef}
        value={query}
        onChange={event => { setQuery(event.target.value); setHighlight(0) }}
        placeholder="搜索收藏夹（标题/网址/备注）"
        size="large"
        prefix={<StarFilled />}
        suffix={<Typography.Text type="secondary">↑↓ 选择 · Enter 打开 · Del 删除 · Ctrl+E 编辑</Typography.Text>}
      />
      <div className="tab-search-palette__list">
        {rows.length === 0
          ? <div className="tab-search-palette__empty">没有匹配的收藏夹条目</div>
          : <List
              dataSource={rows}
              renderItem={(row, index) => <BookmarkRow item={row} active={highlight === index} onHover={() => setHighlight(index)} onOpen={() => { onOpen(row); onClose() }} onRemove={() => onRemove(row)} />}
            />}
        {rows.length > 0 && <Typography.Text type="secondary" className="tab-search-palette__hint">显示 {rows.length} / {bookmarks.length} 条收藏</Typography.Text>}
      </div>
    </div>
  </Modal>
}

interface BookmarkRowProps {
  item: BookmarkSearchResult
  active: boolean
  onHover: () => void
  onOpen: () => void
  onRemove: () => void
}

function BookmarkRow({ item, active, onHover, onOpen, onRemove }: BookmarkRowProps) {
  return <List.Item
    className={`tab-search-row${active ? ' is-active' : ''}`}
    onMouseEnter={onHover}
    onClick={onOpen}
    actions={[<Tooltip key="remove" title="从收藏夹移除"><Button type="text" danger icon={<DeleteOutlined />} aria-label="从收藏夹移除" onClick={event => { event.stopPropagation(); onRemove() }} /></Tooltip>]}
  >
    <List.Item.Meta
      avatar={<StarFilled style={{ color: '#d49a26' }} />}
      title={<>
        {highlight(item.title, item.titleHighlights)}
        {item.folder && <Tag color="geekblue" style={{ marginLeft: 6 }}>{item.folder}</Tag>}
      </>}
      description={<>
        {highlight(item.url, item.urlHighlights)}
        {item.note && <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0', fontSize: 12 }}>{highlight(item.note, item.noteHighlights)}</Typography.Paragraph>}
      </>}
    />
  </List.Item>
}
