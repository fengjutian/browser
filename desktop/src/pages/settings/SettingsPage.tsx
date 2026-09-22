import { Alert, Button, Card, Form, Input, InputNumber, List, Select, Space, Tabs, Tag, Typography, message } from 'antd'
import { DeleteOutlined, KeyOutlined, SafetyCertificateOutlined, SaveOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { PageHeader } from '../../shared/components/PageHeader'
import { deleteAIProvider, exportBackup, getAIProvider, importBackup, listAIProviders, saveAIProvider, type AIProviderInput } from '../../api'
import type { AIProvider, AIProviderType } from '../../types'

const PROVIDER_OPTIONS: { label: string; value: AIProviderType }[] = [
  { label: 'OpenAI 兼容（API Key）', value: 'openai-compatible' },
  { label: 'Ollama（本地）', value: 'ollama' },
]

interface ProviderFormValues {
  id?: string
  type: AIProviderType
  baseUrl: string
  model: string
  embeddingModel?: string
  timeoutSeconds: number
  apiKey?: string
}

function AIProviderSettings() {
  const [messageApi, contextHolder] = message.useMessage()
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<ProviderFormValues>()
  const activeType = Form.useWatch('type', form)

  async function refresh() { setProviders(await listAIProviders()) }

  useEffect(() => { void refresh() }, [])

  async function handleEdit(provider: AIProvider) {
    form.setFieldsValue({
      id: provider.id,
      type: provider.type,
      baseUrl: provider.baseUrl,
      model: provider.model,
      embeddingModel: provider.embeddingModel,
      timeoutSeconds: provider.timeoutSeconds,
      apiKey: '',
    })
  }

  async function handleDelete(provider: AIProvider) {
    try {
      await deleteAIProvider(provider.id)
      messageApi.success('Provider 已删除')
      if (form.getFieldValue('id') === provider.id) form.resetFields()
      await refresh()
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  async function handleSubmit(values: ProviderFormValues) {
    setSaving(true)
    try {
      const payload: AIProviderInput = {
        id: values.id,
        type: values.type,
        baseUrl: values.baseUrl.trim(),
        model: values.model.trim(),
        embeddingModel: values.embeddingModel?.trim() || undefined,
        timeoutSeconds: values.timeoutSeconds,
        apiKey: values.apiKey?.trim() || undefined,
        clearApiKey: values.id ? !values.apiKey?.trim() : false,
      }
      const saved = await saveAIProvider(payload)
      messageApi.success(`已保存「${saved.model}」`)
      form.resetFields()
      form.setFieldsValue({ type: values.type, timeoutSeconds: values.timeoutSeconds })
      await refresh()
      const fresh = await getAIProvider(saved.id)
      if (fresh) form.setFieldsValue({ id: fresh.id })
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return <>{contextHolder}<Card title="AI Provider" className="settings-card"><Typography.Paragraph type="secondary">连接兼容 Provider，用于摘要、翻译和知识问答。普通配置写入本地 SQLite，API Key 通过操作系统密钥环保存；前端不会回显 Key 明文。</Typography.Paragraph>
    <Form form={form} layout="vertical" initialValues={{type:'openai-compatible',timeoutSeconds:60}} onFinish={handleSubmit}>
      <Space wrap>
        <Form.Item name="type" label="Provider 类型" rules={[{required:true}]}><Select options={PROVIDER_OPTIONS} style={{minWidth:220}}/></Form.Item>
        <Form.Item name="baseUrl" label="Base URL" rules={[{required:true,message:'请输入 Base URL'},{type:'url',message:'需为有效 http(s) URL'}]}><Input placeholder="https://api.example.com/v1" style={{minWidth:280}}/></Form.Item>
        <Form.Item name="model" label="模型" rules={[{required:true,message:'请输入模型名称'}]}><Input placeholder="gpt-4o-mini" style={{minWidth:200}}/></Form.Item>
        <Form.Item name="embeddingModel" label="Embedding 模型（可选）"><Input placeholder="text-embedding-3-small" style={{minWidth:220}}/></Form.Item>
        <Form.Item name="timeoutSeconds" label="超时（秒）" rules={[{type:'number',min:1,max:600,message:'范围 1-600'}]}><InputNumber min={1} max={600} style={{width:120}}/></Form.Item>
        <Form.Item name="apiKey" label={activeType === 'ollama' ? 'API Key（可选）' : 'API Key'} tooltip="已保存的 Key 不会回显，留空表示不清除"><Input.Password prefix={<KeyOutlined/>} placeholder={activeType === 'ollama' ? '本地服务通常不需要' : 'sk-...'} style={{minWidth:260}} autoComplete="off"/></Form.Item>
      </Space>
      <Space>
        <Button type="primary" htmlType="submit" icon={<SaveOutlined/>} loading={saving}>保存到密钥环</Button>
        <Button onClick={()=>form.resetFields()}>清空</Button>
      </Space>
    </Form>
    <Typography.Title level={4} style={{marginTop:24}}>已配置 Provider</Typography.Title>
    {providers.length === 0
      ? <Typography.Text type="secondary">尚未配置。</Typography.Text>
      : <List size="small" dataSource={providers} renderItem={provider => <List.Item key={provider.id} actions={[<Button size="small" onClick={()=>void handleEdit(provider)}>编辑</Button>,<Button size="small" danger icon={<DeleteOutlined/>} onClick={()=>void handleDelete(provider)}>删除</Button>]}>
          <List.Item.Meta title={<Space><Tag color={provider.type === 'ollama' ? 'geekblue' : 'purple'}>{provider.type}</Tag><span>{provider.model}</span><Tag>{provider.baseUrl}</Tag>{provider.hasApiKey && <Tag color="green" icon={<KeyOutlined/>}>密钥已配置</Tag>}</Space>} description={`超时 ${provider.timeoutSeconds}s${provider.embeddingModel ? ` · embedding ${provider.embeddingModel}` : ''} · 更新于 ${new Date(provider.updatedAt).toLocaleString()}`}/>
        </List.Item>}/>}
    <Alert className="security-alert" icon={<SafetyCertificateOutlined/>} showIcon type="success" message="密钥只保存在本机" description="凭据由操作系统安全存储，不会写入应用日志或数据库。"/>
  </Card></>
}

function KnowledgeBaseSettings() {
  const [messageApi, contextHolder] = message.useMessage()
  function doExport() {
    void (async () => {
      try {
        const backup = await exportBackup()
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `arcadia-knowledge-${new Date().toISOString().slice(0, 10)}.json`
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
        messageApi.success(`已导出 ${backup.documents.length} 篇文档、${backup.session.length} 条会话状态`)
      } catch (error) {
        messageApi.error(error instanceof Error ? error.message : '导出失败')
      }
    })()
  }
  function doImport() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = () => {
      void (async () => {
        const file = input.files?.[0]
        if (!file) return
        try {
          const text = await file.text()
          const backup = JSON.parse(text) as Parameters<typeof importBackup>[0]
          const summary = await importBackup(backup)
          messageApi.success(`导入 ${summary.documentsInserted} 篇文档、${summary.sessionInserted} 条会话`)
        } catch (error) {
          messageApi.error(error instanceof Error ? error.message : '导入失败')
        }
      })()
    }
    input.click()
  }
  return <>{contextHolder}<Card title="知识库备份" className="settings-card"><Typography.Paragraph type="secondary">导出本地文档和会话状态为 JSON 文件；恢复时会以文档 id 做 upsert，已存在的条目会被覆盖。</Typography.Paragraph><Space><Button type="primary" onClick={doExport}>导出备份</Button><Button onClick={doImport}>从文件恢复</Button></Space></Card></>
}

export function SettingsPage() {
  const items = ['通用','浏览器','隐私','AI Provider','知识库','插件','高级'].map((label, index) => ({
    key: label,
    label,
    children: index === 3 ? <AIProviderSettings/> : index === 4 ? <KnowledgeBaseSettings/> : <Card><Typography.Title level={4}>{label}</Typography.Title><Typography.Paragraph type="secondary">该设置模块将在对应开发阶段开放。</Typography.Paragraph></Card>,
  }))
  return <section className="page"><PageHeader eyebrow="PREFERENCES" title="设置" description="调整浏览器、隐私、AI Provider 与知识库工作流。"/><Tabs tabPosition="left" items={items} defaultActiveKey="AI Provider"/></section>
}
