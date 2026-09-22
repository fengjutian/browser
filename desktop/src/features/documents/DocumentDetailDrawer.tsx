import { Button, Descriptions, Drawer, Empty, Popconfirm, Space, Tag, Typography, message } from 'antd'
import { CopyOutlined, DeleteOutlined, ExportOutlined, LinkOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Document } from '../../types'
import { deleteDocument } from '../../api'

export function DocumentDetailDrawer({ document, onClose, onDeleted }: { document: Document|null; onClose:()=>void; onDeleted:(id:string)=>void }) {
  const [messageApi, contextHolder] = message.useMessage()
  async function remove(){if(!document)return;try{await deleteDocument(document.id);messageApi.success('文档已删除');onDeleted(document.id);onClose()}catch{messageApi.error('删除失败，请稍后重试')}}
  async function copyMarkdown(text: string){try{await navigator.clipboard.writeText(text);messageApi.success('Markdown 已复制')}catch{messageApi.error('复制失败，请检查浏览器权限')}}
  async function copyLink(url: string){try{await navigator.clipboard.writeText(url);messageApi.success('链接已复制')}catch{messageApi.error('复制失败，请检查浏览器权限')}}
  return <>{contextHolder}<Drawer width="min(860px, 82vw)" open={Boolean(document)} onClose={onClose} title={document?.title} extra={document&&<Space><Button icon={<LinkOutlined/>} href={document.url} target="_blank">原文</Button><Button icon={<CopyOutlined/>} onClick={()=>void copyLink(document.url)}>复制链接</Button><Popconfirm title="删除这篇文档？" description="该操作会同时删除全文索引和标签关联。" okText="删除" cancelText="取消" okButtonProps={{danger:true}} onConfirm={()=>void remove()}><Button danger icon={<DeleteOutlined/>}>删除</Button></Popconfirm></Space>}>
    {document&&<article className="document-reader"><Space wrap>{document.tags.map(tag=><Tag color="green" key={tag}>{tag}</Tag>)}<Tag>{document.status}</Tag></Space><Typography.Title>{document.title}</Typography.Title>{document.summary&&<Typography.Paragraph className="document-reader__summary">{document.summary}</Typography.Paragraph>}<Descriptions size="small" column={2} items={[{key:'source',label:'来源',children:document.source||'网页'},{key:'words',label:'字数',children:document.wordCount.toLocaleString()},{key:'url',label:'URL',span:2,children:<Typography.Text ellipsis={{tooltip:document.url}}>{document.url}</Typography.Text>}]} /><div className="markdown-body">{document.markdown?<ReactMarkdown remarkPlugins={[remarkGfm]}>{document.markdown}</ReactMarkdown>:<Empty description="这篇文档没有可阅读的 Markdown 正文"/>}</div><Space><Button icon={<CopyOutlined/>} disabled={!document.markdown} onClick={()=>void copyMarkdown(document.markdown ?? '')}>复制 Markdown</Button><Button icon={<ExportOutlined/>} href={`data:text/markdown;charset=utf-8,${encodeURIComponent(document.markdown??'')}`} download={`${document.title}.md`}>导出 Markdown</Button></Space></article>}
  </Drawer></>
}
