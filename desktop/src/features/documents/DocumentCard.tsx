import { Card, Space, Tag, Tooltip, Typography } from 'antd'
import { ClockCircleOutlined, FileTextOutlined, MoreOutlined, StarFilled, StarOutlined } from '@ant-design/icons'
import type { Document } from '../../types'

export function DocumentCard({ document, onOpen, onToggleStarred }: { document: Document; onOpen?: (document: Document) => void; onToggleStarred?: (document: Document) => void }) {
  const stop = (event: React.MouseEvent) => event.stopPropagation()
  return <Card hoverable onClick={() => onOpen?.(document)} className="document-card" cover={<div className="document-cover"><span className="document-cover__icon"><FileTextOutlined/></span><small>{document.source ?? 'Web article'}</small></div>} actions={[<span key="words"><ClockCircleOutlined/> {document.wordCount.toLocaleString()} 字</span>, <Tooltip title={document.starred ? '取消收藏' : '收藏'} mouseEnterDelay={0.6}><span key="star" onClick={event => { stop(event); onToggleStarred?.(document) }} className={`document-card__star${document.starred ? ' is-starred' : ''}`} role="button" aria-label={document.starred ? '取消收藏' : '收藏'}>{document.starred ? <StarFilled/> : <StarOutlined/>}</span></Tooltip>, <MoreOutlined key="more"/>]}><Space size={4} wrap>{document.tags.slice(0,3).map(tag=><Tag color="green" key={tag}>{tag}</Tag>)}</Space><Typography.Title level={4}>{document.title}</Typography.Title><Typography.Paragraph ellipsis={{rows:2}}>{document.summary??document.markdown}</Typography.Paragraph></Card>
}
