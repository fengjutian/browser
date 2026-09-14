import { Col, Row, Skeleton, Statistic, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { PageHeader } from '../../shared/components/PageHeader'
import { DocumentCard } from '../../features/documents/DocumentCard'
import { loadDocuments } from '../../features/documents/documentService'
import type { Document } from '../../types'
export function LibraryPage() { const [documents, setDocuments] = useState<Document[]>([]); useEffect(() => { void loadDocuments().then(result => setDocuments(result.items)) }, []); return <section className="page"><PageHeader eyebrow="KNOWLEDGE BASE" title="你的知识库" description="保存的网页会在这里沉淀、组织并被重新发现。" action="添加文档"/><Row gutter={12} className="stats-row"><Col span={8}><Statistic title="文档" value={documents.length}/></Col><Col span={8}><Statistic title="集合" value={6}/></Col><Col span={8}><Statistic title="已保存字数" value={18.4} suffix="k"/></Col></Row><Typography.Title level={3}>最近保存</Typography.Title>{!documents.length ? <Skeleton active/> : <Row gutter={[16,16]}>{documents.map(document => <Col xs={24} xl={12} xxl={8} key={document.id}><DocumentCard document={document}/></Col>)}</Row>}</section> }
