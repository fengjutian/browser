import { Button, Col, Empty, Input, List, Modal, Row, Skeleton, Space, Statistic, Tabs, Tag, Typography, message } from 'antd'
import { ClockCircleOutlined, DeleteOutlined, DownloadOutlined, FileTextOutlined, FolderOpenOutlined, FolderOutlined, GlobalOutlined, PlusOutlined, StarOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { PageHeader } from '../../shared/components/PageHeader'
import { DocumentCard } from '../../features/documents/DocumentCard'
import { DocumentDetailDrawer } from '../../features/documents/DocumentDetailDrawer'
import { TaskPanel } from '../../features/tasks/TaskPanel'
import { loadDocuments } from '../../features/documents/documentService'
import { createCollection, deleteCollection, getSession, listCollections, toggleStarred, type Collection } from '../../api'
import { parseHistory, type HistoryEntry } from '../../features/history/dedupeHistory'
import { trackDownload, type DownloadEntry } from '../../features/downloads/trackDownload'
import type { Document } from '../../types'

export function LibraryPage() {
  const [documents,setDocuments]=useState<Document[]>([])
  const [collections,setCollections]=useState<Collection[]>([])
  const [selected,setSelected]=useState<Document|null>(null)
  const [loaded,setLoaded]=useState(false)
  const [offline,setOffline]=useState(false)
  const [history,setHistory]=useState<HistoryEntry[]>([])
  const [downloads,setDownloads]=useState<DownloadEntry[]>([])
  const [creating,setCreating]=useState(false)
  const [newName,setNewName]=useState('')
  const [messageApi, contextHolder] = message.useMessage()
  async function refreshCollections() { setCollections(await listCollections()) }
  useEffect(()=>{
    void loadDocuments().then(result=>{setDocuments(result.items);setOffline(result.offline);setLoaded(true)})
    void getSession('browser.history').then(raw => setHistory(parseHistory(raw)))
    void refreshCollections()
  },[])
  function onExported(document: Document) {
    setDownloads(current => trackDownload(current, { documentId: document.id, title: document.title, exportedAt: Date.now() }))
  }
  async function toggleStar(document: Document) {
    const next = !document.starred
    const optimistic = documents.map(item => item.id === document.id ? { ...item, starred: next } : item)
    setDocuments(optimistic)
    try {
      await toggleStarred(document.id, next)
      messageApi.success(next ? '已收藏' : '已取消收藏')
    } catch (error) {
      setDocuments(documents)
      messageApi.error(error instanceof Error ? error.message : '收藏状态更新失败')
    }
  }
  async function handleArchived(document: Document) {
    setDocuments(items => items.map(item => item.id === document.id ? { ...item, status: 'ARCHIVED' } : item))
  }
  async function handleDocumentUpdated(document: Document) {
    setDocuments(items => items.map(item => item.id === document.id ? document : item))
    await refreshCollections()
  }
  async function createNewCollection() {
    const name = newName.trim()
    if (!name) return
    try {
      await createCollection(name)
      setNewName('')
      setCreating(false)
      await refreshCollections()
      messageApi.success('集合已创建')
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '创建集合失败')
    }
  }
  async function removeCollection(collection: Collection) {
    try {
      await deleteCollection(collection.id)
      await refreshCollections()
      messageApi.success('集合已删除')
    } catch {
      messageApi.error('删除集合失败')
    }
  }
  const starredCount = documents.filter(item => item.starred).length
  const recentHistory = history.slice(0, 8)
  const recentDownloads = downloads.slice(0, 8)
  const collectionContent = <div className="library-module">
    <div className="library-module__head"><div><Typography.Title level={3}>集合</Typography.Title><Typography.Text type="secondary">按主题整理保存的网页和笔记。</Typography.Text></div><Button icon={<PlusOutlined/>} onClick={()=>setCreating(true)}>新建集合</Button></div>
    {collections.length === 0
      ? <Empty className="library-empty" image={<FolderOpenOutlined/>} description="还没有集合，点击「新建集合」开始整理。"/>
      : <Row gutter={[12,12]}>{collections.map(collection => <Col xs={24} sm={12} lg={8} xl={6} key={collection.id}><div className="collection-card"><div className="collection-card__head"><FolderOutlined/><Typography.Text strong>{collection.name}</Typography.Text><Tag>{collection.documentCount}</Tag></div>{collection.description && <Typography.Paragraph type="secondary">{collection.description}</Typography.Paragraph>}<Space><Button danger size="small" icon={<DeleteOutlined/>} onClick={()=>void removeCollection(collection)}>删除</Button></Space></div></Col>)}</Row>}
  </div>
  const historyContent = <div className="library-module"><div className="library-module__head"><div><Typography.Title level={3}>近期浏览</Typography.Title><Typography.Text type="secondary">最近访问过的网页，按时间倒序排列。</Typography.Text></div></div>
    {recentHistory.length===0?<Empty description="暂无浏览记录"/>:<List size="small" className="library-history" dataSource={recentHistory} renderItem={item => <List.Item key={item.url + item.visitedAt}><List.Item.Meta avatar={<span className="library-list-icon"><ClockCircleOutlined/></span>} title={<Typography.Text ellipsis={{ tooltip: item.title }}>{item.title || item.url}</Typography.Text>} description={<Typography.Text type="secondary" ellipsis>{new Date(item.visitedAt).toLocaleString()} · <GlobalOutlined/> {item.url}</Typography.Text>}/></List.Item>}/>} 
  </div>
  const downloadContent = <div className="library-module"><div className="library-module__head"><div><Typography.Title level={3}>下载记录</Typography.Title><Typography.Text type="secondary">从知识库导出的 Markdown 文件。</Typography.Text></div></div>
    {recentDownloads.length===0?<Empty description="暂无下载记录"/>:<List size="small" className="library-downloads" dataSource={recentDownloads} renderItem={item => <List.Item key={item.documentId + item.exportedAt}><List.Item.Meta avatar={<span className="library-list-icon"><DownloadOutlined/></span>} title={<Typography.Text ellipsis={{ tooltip: item.title }}>{item.title || '(无标题)'}</Typography.Text>} description={<Typography.Text type="secondary">{new Date(item.exportedAt).toLocaleString()}</Typography.Text>}/></List.Item>}/>} 
  </div>
  const documentContent = <div className="library-module"><div className="library-module__head"><div><Typography.Title level={3}>最近保存</Typography.Title><Typography.Text type="secondary">已沉淀到本地知识库的内容。</Typography.Text></div></div>
    {!loaded?<Skeleton active/>:!documents.length?<Empty description={offline?'本地数据服务未连接':'暂无保存内容，请先从浏览器保存网页。'}/>:<Row gutter={[12,12]}>{documents.map(document=><Col xs={24} lg={12} xl={8} key={document.id}><DocumentCard document={document} onOpen={setSelected} onToggleStarred={toggleStar} onArchived={handleArchived} onChanged={refreshCollections}/></Col>)}</Row>}
    <TaskPanel/>
  </div>
  return <section className="page">{contextHolder}<PageHeader eyebrow="KNOWLEDGE BASE" title="你的知识库" description="保存的网页会在这里沉淀、组织并被重新发现。" action="添加文档"/>
    <Row gutter={12} className="stats-row library-stats"><Col span={8}><Statistic prefix={<span className="library-stat-icon"><FileTextOutlined/></span>} title="文档" value={documents.length}/></Col><Col span={8}><Statistic prefix={<span className="library-stat-icon"><StarOutlined/></span>} title="收藏" value={starredCount}/></Col><Col span={8}><Statistic prefix={<span className="library-stat-icon"><FolderOutlined/></span>} title="集合" value={collections.length}/></Col></Row>
    <Tabs className="library-tabs" defaultActiveKey="documents" destroyOnHidden={false} items={[
      {key:'documents',label:`最近保存 ${documents.length}`,children:documentContent},
      {key:'collections',label:`集合 ${collections.length}`,children:collectionContent},
      {key:'history',label:`近期浏览 ${recentHistory.length}`,children:historyContent},
      {key:'downloads',label:`下载记录 ${recentDownloads.length}`,children:downloadContent},
    ]}/>
    <Modal title="新建集合" open={creating} onCancel={()=>{setCreating(false);setNewName('')}} onOk={()=>void createNewCollection()} okText="创建" cancelText="取消"><Input autoFocus placeholder="集合名称" value={newName} onChange={event=>setNewName(event.target.value)} onPressEnter={()=>void createNewCollection()}/></Modal>
    <DocumentDetailDrawer document={selected} onClose={()=>setSelected(null)} onDeleted={id=>setDocuments(items=>items.filter(item=>item.id!==id))} onExported={onExported} onUpdated={handleDocumentUpdated}/>
  </section>
}
