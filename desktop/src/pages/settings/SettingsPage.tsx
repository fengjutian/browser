import { Alert, Button, Card, Form, Input, Select, Space, Tabs, Typography, message } from 'antd'
import { SafetyCertificateOutlined } from '@ant-design/icons'
import { PageHeader } from '../../shared/components/PageHeader'
import { exportBackup, importBackup } from '../../api'

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
  const ai = <Card title="AI Provider" className="settings-card"><Typography.Paragraph type="secondary">连接兼容 Provider，用于摘要、翻译和知识问答。</Typography.Paragraph><Form layout="vertical"><Form.Item label="Provider"><Select options={[{value:'none',label:'未配置'},{value:'openai',label:'OpenAI Compatible'},{value:'ollama',label:'Ollama（本地）'}]} defaultValue="none"/></Form.Item><Form.Item label="Base URL"><Input placeholder="https://api.example.com/v1"/></Form.Item><Form.Item label="模型"><Input placeholder="选择模型"/></Form.Item><Form.Item label="API Key"><Input.Password placeholder="存储在系统密钥环"/></Form.Item><Button type="primary">安全保存</Button></Form><Alert className="security-alert" icon={<SafetyCertificateOutlined/>} showIcon type="success" message="密钥只保存在本机" description="凭据由操作系统安全存储，不会写入应用日志。"/></Card>
  const items = ['通用','浏览器','隐私','AI Provider','知识库','插件','高级'].map((label, index) => ({
    key: label,
    label,
    children: index === 3 ? ai : index === 4 ? <KnowledgeBaseSettings/> : <Card><Typography.Title level={4}>{label}</Typography.Title><Typography.Paragraph type="secondary">该设置模块将在对应开发阶段开放。</Typography.Paragraph></Card>,
  }))
  return <section className="page"><PageHeader eyebrow="PREFERENCES" title="设置" description="调整浏览器、隐私、AI Provider 与知识库工作流。"/><Tabs tabPosition="left" items={items} defaultActiveKey="AI Provider"/></section>
}
