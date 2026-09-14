import { Card, Space, Tag, Typography } from 'antd'
import { ClockCircleOutlined, FileTextOutlined, MoreOutlined } from '@ant-design/icons'
import type { Document } from '../../types'

export function DocumentCard({ document, onOpen }: { document: Document; onOpen?: (document: Document) => void }) {
  return <Card hoverable onClick={() => onOpen?.(document)} className="document-card" cover={<div className="document-cover"><span className="document-cover__icon"><FileTextOutlined/></span><small>{document.source ?? 'Web article'}</small></div>} actions={[<span key="words"><ClockCircleOutlined/> {document.wordCount.toLocaleString()} 字</span>, <MoreOutlined key="more"/>]}><Space size={4} wrap>{document.tags.slice(0,3).map(tag=><Tag color="green" key={tag}>{tag}</Tag>)}</Space><Typography.Title level={4}>{document.title}</Typography.Title><Typography.Paragraph ellipsis={{rows:2}}>{document.summary??document.markdown}</Typography.Paragraph></Card>
}
