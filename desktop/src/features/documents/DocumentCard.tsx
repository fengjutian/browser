import { Typography, message } from 'antd'
import { Button, Card, Dropdown, Input, Popover, Space, Tag, Tooltip } from '../../components/ui'
import { ClockCircleOutlined, FileTextOutlined, FolderAddOutlined, InboxOutlined, MoreOutlined, StarFilled, StarOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import type { Document } from '../../types'
import { addToCollection, archiveDocument, createCollection, listCollections, type Collection } from '../../api'

export function DocumentCard({ document, onOpen, onToggleStarred, onArchived, onChanged }: { document: Document; onOpen?: (document: Document) => void; onToggleStarred?: (document: Document) => void; onArchived?: (document: Document) => void; onChanged?: () => void }) {
  const stop = (event: React.MouseEvent) => event.stopPropagation()
  const [messageApi, messageContext] = message.useMessage()
  const [collections, setCollections] = useState<Collection[]>([])
  const [newCollection, setNewCollection] = useState('')
  const [popoverOpen, setPopoverOpen] = useState(false)
  useEffect(() => {
    if (!popoverOpen) return
    void listCollections().then(setCollections).catch(() => setCollections([]))
  }, [popoverOpen])
  async function join(collectionId: string) {
    try {
      await addToCollection(collectionId, document.id)
      messageApi.success('已加入集合')
      setPopoverOpen(false)
      onChanged?.()
    } catch {
      messageApi.error('加入集合失败')
    }
  }
  async function quickCreate() {
    const name = newCollection.trim()
    if (!name) return
    try {
      const created = await createCollection(name)
      await addToCollection(created.id, document.id)
      messageApi.success(`已创建集合「${created.name}」并加入`)
      setNewCollection('')
      setPopoverOpen(false)
      onChanged?.()
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '创建集合失败')
    }
  }
  async function archive() {
    try {
      await archiveDocument(document.id)
      messageApi.success('已归档')
      onArchived?.(document)
    } catch {
      messageApi.error('归档失败')
    }
  }
  return <>{messageContext}<Card hoverable onClick={() => onOpen?.(document)} className="document-card" cover={<div className="document-cover"><span className="document-cover__icon"><FileTextOutlined/></span><small>{document.source ?? 'Web article'}</small></div>} actions={[<span key="words"><ClockCircleOutlined/> {document.wordCount.toLocaleString()} 字</span>, <Tooltip title={document.starred ? '取消收藏' : '收藏'} mouseEnterDelay={0.6}><span key="star" onClick={event => { stop(event); onToggleStarred?.(document) }} className={`document-card__star${document.starred ? ' is-starred' : ''}`} role="button" aria-label={document.starred ? '取消收藏' : '收藏'}>{document.starred ? <StarFilled/> : <StarOutlined/>}</span></Tooltip>, <Popover trigger="click" open={popoverOpen} onOpenChange={setPopoverOpen} placement="topRight" content={<div className="document-card__join"><Typography.Text strong>加入集合</Typography.Text>{collections.length === 0 && <Typography.Paragraph type="secondary">还没有集合。</Typography.Paragraph>}{collections.map(collection => <Button key={collection.id} type="text" block onClick={() => void join(collection.id)}>{collection.name} <Tag>{collection.documentCount}</Tag></Button>)}<Space.Compact style={{width:'100%'}}><Input placeholder="新建集合并加入" value={newCollection} onChange={event => setNewCollection(event.target.value)} onPressEnter={() => void quickCreate()}/><Button type="primary" onClick={() => void quickCreate()}>建</Button></Space.Compact></div>}><span key="more" onClick={stop} role="button" aria-label="更多"><FolderAddOutlined/></span></Popover>, <Dropdown menu={{items:[{key:'archive',label:'归档',icon:<InboxOutlined/>,disabled:document.status === 'ARCHIVED',onClick:()=>void archive()}]}} trigger={['click']}><span key="menu" onClick={stop} role="button" aria-label="操作"><MoreOutlined/></span></Dropdown>]}><Space size={4} wrap>{document.tags.slice(0,3).map(tag=><Tag className="document-tag" key={tag}>{tag}</Tag>)}</Space><Typography.Title level={4}>{document.title}</Typography.Title><Typography.Paragraph ellipsis={{rows:2}}>{document.summary??document.markdown}</Typography.Paragraph></Card></>
}
