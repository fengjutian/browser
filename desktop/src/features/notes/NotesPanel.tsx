import { useMemo, useState } from 'react'
import { Button, Empty, Input, Popconfirm, Space, Tooltip, Typography } from '../../components/ui'
import { CloseOutlined, DeleteOutlined, EditOutlined, PushpinFilled, PushpinOutlined } from '../../components/ui/icons'
import {
  groupNotesByUrl,
  removeNote,
  updateNote,
  type NoteEntry,
} from './notes'

export interface NotesPanelProps {
  open: boolean
  notes: NoteEntry[]
  onToggle: () => void
  onRemove: (id: string) => void
  onUpdate: (id: string, patch: Partial<Pick<NoteEntry, 'comment' | 'text' | 'title'>>) => void
}

export function NotesPanel({ open, notes, onToggle, onRemove, onUpdate }: NotesPanelProps) {
  const groups = useMemo(() => groupNotesByUrl(notes), [notes])
  const [editingId, setEditingId] = useState<string | null>(null)

  if (!open) {
    return <Tooltip title="笔记面板 (Ctrl+Shift+N)" placement="left">
      <button type="button" className="notes-panel-toggle is-collapsed" onClick={onToggle} aria-label="打开笔记面板">
        <PushpinOutlined />
      </button>
    </Tooltip>
  }

  return <aside className="notes-panel" role="complementary" aria-label="笔记面板">
    <header className="notes-panel__header">
      <Space>
        <PushpinFilled style={{ color: '#a7dfbd' }} />
        <Typography.Text strong>网页笔记</Typography.Text>
        <Typography.Text type="secondary">{notes.length} 条</Typography.Text>
      </Space>
      <Button type="text" icon={<CloseOutlined />} onClick={onToggle} aria-label="关闭笔记面板" />
    </header>
    <div className="notes-panel__body">
      {groups.length === 0
        ? <Empty description={<>
            <p>右键选中文本 → "加入笔记"</p>
            <Typography.Text type="secondary">选中文字会在此面板里出现，方便日后回顾。</Typography.Text>
          </>} />
        : groups.map(group => <section key={group.url} className="notes-panel__group">
            <header>
              <Typography.Text ellipsis style={{ maxWidth: 240 }} title={group.url}>{group.title || group.url}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{group.notes.length} 条</Typography.Text>
            </header>
            {group.notes.map(note => <article key={note.id} className="notes-panel__note">
              <blockquote>{note.text}</blockquote>
              {editingId === note.id
                ? <Space.Compact style={{ width: '100%' }}>
                    <Input.TextArea
                      autoSize={{ minRows: 1, maxRows: 4 }}
                      defaultValue={note.comment}
                      onChange={event => onUpdate(note.id, { comment: event.target.value })}
                    />
                    <Button type="text" icon={<CloseOutlined />} onClick={() => setEditingId(null)}>完成</Button>
                  </Space.Compact>
                : note.comment && <p className="notes-panel__comment">{note.comment}</p>}
              <footer>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>{new Date(note.createdAt).toLocaleString('zh-CN')}</Typography.Text>
                <Space size={4}>
                    <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditingId(editingId === note.id ? null : note.id)}>批注</Button>
                    <Popconfirm title="删除这条笔记？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => onRemove(note.id)}>
                      <Button type="text" size="small" danger icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>
                  </Space>
              </footer>
            </article>)}
          </section>)}
    </div>
  </aside>
}

// Re-export the helpers that the panel uses so the BrowserPage can avoid
// double-importing the module when wiring onRemove / onUpdate.
export { removeNote, updateNote }
