import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Input, List, Modal, Popconfirm, Typography, type InputRef } from '../../components/ui'
import { DeleteOutlined, GlobalOutlined } from '@ant-design/icons'
import type { HistoryEntry } from './dedupeHistory'
import { searchHistory, type HistorySearchResult } from './historySearchIndex'

export interface HistorySearchPaletteProps {
  open: boolean
  history: HistoryEntry[]
  onClose: () => void
  onOpen: (entry: HistoryEntry) => void
  onRemove: (entry: HistoryEntry) => void
  onClear: () => void
}

const RELATIVE = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }) : null

function formatVisited(visitedAt: number, now = Date.now()): string {
  if (!RELATIVE) return new Date(visitedAt).toLocaleString('zh-CN')
  const delta = visitedAt - now
  const abs = Math.abs(delta)
  if (abs < 60_000) return RELATIVE.format(Math.round(delta / 1000), 'second')
  if (abs < 3_600_000) return RELATIVE.format(Math.round(delta / 60_000), 'minute')
  if (abs < 86_400_000) return RELATIVE.format(Math.round(delta / 3_600_000), 'hour')
  return RELATIVE.format(Math.round(delta / 86_400_000), 'day')
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

/**
 * Command-palette style modal for browsing / searching / deleting history
 * entries. Keyboard-driven: arrows move highlight, Enter opens the current
 * row, Delete removes it, Esc dismisses.
 */
export function HistorySearchPalette({ open, history, onClose, onOpen, onRemove, onClear }: HistorySearchPaletteProps) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<any>(null)

  const rows = useMemo<HistorySearchResult[]>(() => searchHistory(query, history), [query, history])
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
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, rows, current, onOpen, onClose, onRemove])

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
      <div className="history-search-palette__toolbar">
        <Input
          ref={inputRef}
          value={query}
          onChange={event => { setQuery(event.target.value); setHighlight(0) }}
          placeholder="搜索历史记录（标题或网址）"
          size="large"
          prefix={<GlobalOutlined />}
          suffix={<Typography.Text type="secondary">↑↓ 选择 · Enter 打开 · Del 删除</Typography.Text>}
        />
        <Popconfirm title="清空全部历史记录？" okText="清空" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => { onClear(); onClose() }}>
          <Button danger>全部清空</Button>
        </Popconfirm>
      </div>
      <div className="tab-search-palette__list">
        {rows.length === 0
          ? <div className="tab-search-palette__empty">没有匹配的历史记录</div>
          : <List
              dataSource={rows}
              renderItem={(row, index) => <HistoryRow item={row} active={highlight === index} onHover={() => setHighlight(index)} onOpen={() => { onOpen(row); onClose() }} onRemove={() => onRemove(row)} />}
            />}
        {rows.length > 0 && current && <Typography.Text type="secondary" className="tab-search-palette__hint">
          显示 {rows.length} / {history.length} 条历史
        </Typography.Text>}
      </div>
    </div>
  </Modal>
}

interface HistoryRowProps {
  item: HistorySearchResult
  active: boolean
  onHover: () => void
  onOpen: () => void
  onRemove: () => void
}

function HistoryRow({ item, active, onHover, onOpen, onRemove }: HistoryRowProps) {
  return <List.Item
    className={`tab-search-row${active ? ' is-active' : ''}`}
    onMouseEnter={onHover}
    onClick={onOpen}
    actions={[<Button key="remove" type="text" danger icon={<DeleteOutlined />} aria-label="从历史中删除" onClick={event => { event.stopPropagation(); onRemove() }} />]}
  >
    <List.Item.Meta
      avatar={<GlobalOutlined />}
      title={<>{highlight(item.title || item.url, item.titleHighlights)} <Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>{formatVisited(item.visitedAt)}</Typography.Text></>}
      description={highlight(item.url, item.urlHighlights)}
    />
  </List.Item>
}
