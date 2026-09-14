import { Button, Card, Empty, Input, List, Space, Typography } from 'antd'
import { ArrowRightOutlined, FileTextOutlined, RobotOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { PageHeader } from '../../shared/components/PageHeader'
import { listDocuments } from '../../api'
import type { Document } from '../../types'

export function AssistantPage() {
  const [documents, setDocuments] = useState<Document[]>([])
  useEffect(() => { void listDocuments().then(setDocuments).catch(() => setDocuments([])) }, [])
  return <section className="page"><PageHeader eyebrow="KNOWLEDGE ASSISTANT" title="向整个知识库提问" description={`当前基于 ${documents.length} 个真实保存来源。`}/><div className="assistant-grid"><Card className="assistant-chat"><div className="assistant-empty"><span className="assistant-avatar"><RobotOutlined/></span><Typography.Title level={2}>你想了解什么？</Typography.Title><Typography.Paragraph>{documents.length ? '比较观点、发现联系，或把真实浏览资料整理成研究简报。' : '请先在浏览器中保存网页，再基于真实资料提问。'}</Typography.Paragraph>{documents.length > 0 && <Space direction="vertical"><Button>总结我最近保存的内容</Button><Button>比较这些来源的核心观点</Button><Button>从已保存资料生成研究简报</Button></Space>}</div><Input size="large" disabled={!documents.length} placeholder={documents.length ? '向知识库提问…' : '知识库中暂无真实数据'} suffix={<Button disabled={!documents.length} type="primary" shape="circle" icon={<ArrowRightOutlined/>}/>} /></Card><Card title="引用来源"><Typography.Paragraph type="secondary">这里只显示本地知识库中的真实网页。</Typography.Paragraph><List dataSource={documents.slice(0, 5)} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无来源"/> }} renderItem={item => <List.Item><List.Item.Meta avatar={<FileTextOutlined/>} title={item.title} description={item.source || item.url}/></List.Item>}/></Card></div></section>
}
