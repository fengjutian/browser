import { Descriptions, Drawer, Empty, Popconfirm, Typography, message } from 'antd'
import { Button, Input, Space, Tag } from '../../components/ui'
import { CopyOutlined, DeleteOutlined, ExportOutlined, InboxOutlined, LinkOutlined, PlusOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEffect, useState } from 'react'
import type { Document } from '../../types'
import { archiveDocument, deleteDocument, updateTags } from '../../api'

export function DocumentDetailDrawer({ document, onClose, onDeleted, onExported, onUpdated }: { document: Document|null; onClose:()=>void; onDeleted:(id:string)=>void; onExported?: (document: Document) => void; onUpdated?: (document: Document) => void }) {
  const [messageApi, contextHolder] = message.useMessage()
  const [tagsDraft, setTagsDraft] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const autoTags = document?.autoTags ?? []
  useEffect(() => { setTagsDraft(document?.tags ?? []); setTagInput('') }, [document?.id, document?.tags])
  async function remove(){if(!document)return;try{await deleteDocument(document.id);messageApi.success('文档已删除');onDeleted(document.id);onClose()}catch{messageApi.error('删除失败，请稍后重试')}}
  async function archive(){if(!document)return;try{await archiveDocument(document.id);messageApi.success('已归档');onClose()}catch{messageApi.error('归档失败，请稍后重试')}}
  async function persistTags(next: string[]){
    if(!document)return
    try{await updateTags(document.id, next);setTagsDraft(next);onUpdated?.({...document, tags: next});messageApi.success('标签已更新')}catch{messageApi.error('标签更新失败，请稍后重试')}
  }
  function addTag(){
    const value = tagInput.trim()
    if(!value||tagsDraft.includes(value)){setTagInput('');return}
    void persistTags([...tagsDraft, value])
    setTagInput('')
  }
  function removeTag(tag: string){void persistTags(tagsDraft.filter(item => item !== tag))}
  async function copyMarkdown(text: string){try{await navigator.clipboard.writeText(text);messageApi.success('Markdown 已复制')}catch{messageApi.error('复制失败，请检查浏览器权限')}}
  async function copyLink(url: string){try{await navigator.clipboard.writeText(url);messageApi.success('链接已复制')}catch{messageApi.error('复制失败，请检查浏览器权限')}}
  return <>{contextHolder}<Drawer width="min(860px, 82vw)" open={Boolean(document)} onClose={onClose} title={document?.title} extra={document&&<Space><Button icon={<LinkOutlined/>} href={document.url} target="_blank">原文</Button><Button icon={<CopyOutlined/>} onClick={()=>void copyLink(document.url)}>复制链接</Button><Popconfirm title="归档这篇文档？" description="归档后默认不在知识库中显示，可在归档视图中找回。" okText="归档" cancelText="取消" onConfirm={()=>void archive()}><Button icon={<InboxOutlined/>} disabled={document.status === 'ARCHIVED'}>归档</Button></Popconfirm><Popconfirm title="删除这篇文档？" description="该操作会同时删除全文索引和标签关联。" okText="删除" cancelText="取消" okButtonProps={{danger:true}} onConfirm={()=>void remove()}><Button danger icon={<DeleteOutlined/>}>删除</Button></Popconfirm></Space>}>
    {document&&<article className="document-reader"><Space wrap className="document-reader__tags">{tagsDraft.map(tag=><Tag color="green" key={tag} closable onClose={()=>removeTag(tag)}>{tag}</Tag>)}{autoTags.map(tag=><Tag color="geekblue" key={`auto-${tag}`} className="document-tag-auto">{tag} · 自动</Tag>)}<Input size="small" prefix={<PlusOutlined/>} value={tagInput} onChange={event=>setTagInput(event.target.value)} onPressEnter={addTag} placeholder="新增标签" style={{width:140}}/><Tag>{document.status}</Tag></Space><Typography.Title>{document.title}</Typography.Title>{document.summary&&<Typography.Paragraph className="document-reader__summary">{document.summary}</Typography.Paragraph>}<Descriptions size="small" column={2} items={[{key:'source',label:'来源',children:document.source||'网页'},{key:'words',label:'字数',children:document.wordCount.toLocaleString()},{key:'url',label:'URL',span:2,children:<Typography.Text ellipsis={{tooltip:document.url}}>{document.url}</Typography.Text>}]} /><div className="markdown-body">{document.markdown?<ReactMarkdown remarkPlugins={[remarkGfm]}>{document.markdown}</ReactMarkdown>:<Empty description="这篇文档没有可阅读的 Markdown 正文"/>}</div><Space><Button icon={<CopyOutlined/>} disabled={!document.markdown} onClick={()=>void copyMarkdown(document.markdown ?? '')}>复制 Markdown</Button><Button icon={<ExportOutlined/>} href={`data:text/markdown;charset=utf-8,${encodeURIComponent(document.markdown??'')}`} download={`${document.title}.md`} onClick={() => onExported?.(document)}>导出 Markdown</Button></Space></article>}
  </Drawer></>
}
