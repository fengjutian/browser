import { Col, Empty, Row, Skeleton, Statistic, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { PageHeader } from '../../shared/components/PageHeader'
import { DocumentCard } from '../../features/documents/DocumentCard'
import { DocumentDetailDrawer } from '../../features/documents/DocumentDetailDrawer'
import { loadDocuments } from '../../features/documents/documentService'
import type { Document } from '../../types'

export function LibraryPage() {
  const [documents,setDocuments]=useState<Document[]>([])
  const [selected,setSelected]=useState<Document|null>(null)
  const [loaded,setLoaded]=useState(false)
  const [offline,setOffline]=useState(false)
  useEffect(()=>{void loadDocuments().then(result=>{setDocuments(result.items);setOffline(result.offline);setLoaded(true)})},[])
  return <section className="page"><PageHeader eyebrow="KNOWLEDGE BASE" title="你的知识库" description="保存的网页会在这里沉淀、组织并被重新发现。" action="添加文档"/><Row gutter={12} className="stats-row"><Col span={8}><Statistic title="文档" value={documents.length}/></Col><Col span={8}><Statistic title="集合" value={new Set(documents.flatMap(item=>item.tags)).size}/></Col><Col span={8}><Statistic title="已保存字数" value={documents.reduce((sum,item)=>sum+item.wordCount,0)}/></Col></Row><Typography.Title level={3}>最近保存</Typography.Title>{!loaded?<Skeleton active/>:!documents.length?<Empty description={offline?'本地数据服务未连接':'暂无真实浏览数据，请先保存网页到知识库'}/>:<Row gutter={[12,12]}>{documents.map(document=><Col xs={24} lg={12} xl={8} key={document.id}><DocumentCard document={document} onOpen={setSelected}/></Col>)}</Row>}<DocumentDetailDrawer document={selected} onClose={()=>setSelected(null)} onDeleted={id=>setDocuments(items=>items.filter(item=>item.id!==id))}/></section>
}
