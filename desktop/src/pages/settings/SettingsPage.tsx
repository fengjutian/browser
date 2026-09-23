import { Alert, Descriptions, Form, Input, InputNumber, List, Segmented, Select, Switch, Tabs, Typography, message } from 'antd'
import { Button, Card, Space, Tag } from '../../components/ui'
import { BgColorsOutlined, DeleteOutlined, KeyOutlined, MoonOutlined, SafetyCertificateOutlined, SaveOutlined, SunOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { PageHeader } from '../../shared/components/PageHeader'
import { clearBrowserHistory, clearClosedTabs as clearClosedTabsInDb, deleteAIProvider, exportBackup, getAIProvider, getBrowserShortcutsEnabled, importBackup, listAIProviders, listBrowserHistory, replaceSitePermissions, saveAIProvider, aiTestProvider, setBrowserShortcutsEnabled, type AIProviderInput } from '../../api'
import type { AIProvider, AIProviderType } from '../../types'
import { normalizeOrigin, readSitePermissions, writeSitePermissions, type SitePermissionKind, type SitePermissionRule } from '../../features/browser/sitePermissions'
import { readThemePreference, writeThemePreference, type ThemePreference } from '../../features/settings/theme'
import { readSearchEngineConfig, resolveActiveSearchTemplate, SEARCH_ENGINE_PRESETS, writeSearchEngineConfig } from '../../features/browser/searchEngine'
import { isSearchTemplateValid } from '../../features/browser/navigation'
import { HISTORY_CHANGE_EVENT, type HistoryEntry } from '../../features/history/dedupeHistory'
import { DEFAULT_ADVANCED_SETTINGS, readAdvancedSettings, writeAdvancedSettings, type AdvancedSettings } from '../../features/settings/advanced'
import { isTrackingCleanerEnabled, setTrackingCleanerEnabled } from '../../features/plugins/trackingCleaner'
import { isAdBlockerEnabled, setAdBlockerEnabled } from '../../features/plugins/adBlocker'
import { setNativeAdBlocking } from '../../services/nativeBrowser'
import { getBrowserCapabilities, type BrowserCapabilities } from '../../services/browserCapabilities'

const PROVIDER_OPTIONS: { label: string; value: AIProviderType }[] = [
  { label: 'OpenAI 兼容（API Key）', value: 'openai-compatible' },
  { label: 'Ollama（本地）', value: 'ollama' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'Qwen（通义千问）', value: 'qwen' },
  { label: 'Kimi（Moonshot）', value: 'kimi' },
  { label: 'MiniMax', value: 'minimax' },
]

const PROVIDER_PRESETS: Record<AIProviderType, { baseUrl: string; defaultModel: string; placeholderModel: string; embeddingModel?: string; embeddingPlaceholder: string }> = {
  'openai-compatible': { baseUrl: 'https://api.siliconflow.cn/v1', defaultModel: 'Qwen/Qwen3.6-27B', placeholderModel: 'Qwen/Qwen3.6-27B', embeddingModel: 'BAAI/bge-m3', embeddingPlaceholder: 'BAAI/bge-m3' },
  ollama: { baseUrl: 'http://localhost:11434', defaultModel: 'llama3.1', placeholderModel: 'llama3.1', embeddingModel: 'nomic-embed-text', embeddingPlaceholder: 'nomic-embed-text' },
  deepseek: { baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-flash', placeholderModel: 'deepseek-flash', embeddingPlaceholder: '该 Provider 暂无通用 Embedding 默认值' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus', placeholderModel: 'qwen-plus', embeddingModel: 'text-embedding-v3', embeddingPlaceholder: 'text-embedding-v3' },
  kimi: { baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', placeholderModel: 'moonshot-v1-8k', embeddingPlaceholder: '该 Provider 暂无通用 Embedding 默认值' },
  minimax: { baseUrl: 'https://api.minimaxi.com/v1', defaultModel: 'MiniMax-M3', placeholderModel: 'MiniMax-M3', embeddingPlaceholder: 'MiniMax 暂无通用 Embedding 默认值' },
}

const MINIMAX_MODEL_OPTIONS = [
  { label: 'MiniMax M3（最新）', value: 'MiniMax-M3' },
  { label: 'MiniMax M2.7', value: 'MiniMax-M2.7' },
]

const PROVIDER_TAG_COLOR: Record<AIProviderType, string> = {
  'openai-compatible': 'purple',
  ollama: 'geekblue',
  deepseek: 'cyan',
  qwen: 'magenta',
  kimi: 'volcano',
  minimax: 'gold',
}

interface ProviderFormValues {
  id?: string
  type: AIProviderType
  baseUrl: string
  model: string
  embeddingModel?: string
  timeoutSeconds: number
  apiKey?: string
}

function GeneralSettings() {
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference)

  function changeTheme(next: string | number) {
    const preference = next as ThemePreference
    setTheme(preference)
    writeThemePreference(preference)
  }

  return <Card title="外观" className="settings-card theme-settings">
    <Typography.Title level={5}>主题</Typography.Title>
    <Typography.Paragraph type="secondary">选择应用的显示主题。更改会立即生效，并自动保存。</Typography.Paragraph>
    <Segmented block value={theme} onChange={changeTheme} options={[
      { label: <Space><BgColorsOutlined/>绿色</Space>, value: 'green' },
      { label: <Space><BgColorsOutlined/>米色</Space>, value: 'beige' },
      { label: <Space><SunOutlined/>浅色</Space>, value: 'light' },
      { label: <Space><MoonOutlined/>深色</Space>, value: 'dark' },
      { label: 'GitHub', value: 'github' },
    ]}/>
  </Card>
}

const SHORTCUTS_EVENT = 'arcadia-shortcuts-change'

function BrowserSettings() {
  const [enabled, setEnabled] = useState<boolean>(() => getBrowserShortcutsEnabled())
  const [messageApi, contextHolder] = message.useMessage()
  const [config, setConfig] = useState(() => readSearchEngineConfig())
  const [customTemplate, setCustomTemplate] = useState('')
  const presets = SEARCH_ENGINE_PRESETS

  useEffect(() => {
    function onChange(event: Event) {
      const detail = (event as CustomEvent<{ enabled: boolean }>).detail
      setEnabled(detail.enabled)
    }
    window.addEventListener(SHORTCUTS_EVENT, onChange)
    return () => window.removeEventListener(SHORTCUTS_EVENT, onChange)
  }, [])

  function toggle(next: boolean) {
    setEnabled(next)
    setBrowserShortcutsEnabled(next)
  }

  function pickPreset(presetId: string) {
    if (presetId === 'custom') {
      setConfig({ presetId: 'custom', customTemplate: config.customTemplate ?? '' })
      return
    }
    try {
      const next = writeSearchEngineConfig({ presetId })
      setConfig(next)
      messageApi.success(`搜索引擎已切换为 ${presets.find(p => p.id === presetId)?.label ?? presetId}`)
    } catch (error) {
      messageApi.error(String(error))
    }
  }

  function saveCustom() {
    try {
      const next = writeSearchEngineConfig({ presetId: 'custom', customTemplate })
      setConfig(next)
      messageApi.success('自定义搜索引擎已保存')
    } catch (error) {
      messageApi.error(String(error))
    }
  }

  return <>{contextHolder}<Card title="浏览器" className="settings-card">
    <Typography.Title level={5}>键盘快捷键</Typography.Title>
    <Typography.Paragraph type="secondary">关闭后,浏览器视图不再拦截 Ctrl/Cmd + T、W、Tab、1-9、Alt + ←/→ 等全局快捷键,改由各 WebView 自行处理。</Typography.Paragraph>
    <Space>
      <Switch checked={enabled} onChange={toggle} />
      <Typography.Text>{enabled ? '已启用' : '已禁用'}</Typography.Text>
    </Space>
    <Typography.Title level={5} style={{ marginTop: 24 }}>默认搜索引擎</Typography.Title>
    <Typography.Paragraph type="secondary">地址栏中非 URL 输入会展开为搜索引擎查询；模板必须包含 <code>{'{query}'}</code> 占位符。</Typography.Paragraph>
    <Segmented
      block
      value={config.presetId}
      onChange={value => pickPreset(value)}
      options={[
        ...presets.map(p => ({ label: p.label, value: p.id })),
        { label: '自定义', value: 'custom' },
      ]}
    />
    {config.presetId === 'custom' && (
      <Space.Compact block style={{ marginTop: 12 }}>
        <Input
          value={customTemplate || config.customTemplate || ''}
          placeholder="https://example.com/search?q={query}"
          onChange={event => setCustomTemplate(event.target.value)}
        />
        <Button type="primary" onClick={saveCustom} disabled={!isSearchTemplateValid(customTemplate || config.customTemplate || '')}>
          保存
        </Button>
      </Space.Compact>
    )}
    <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
      当前模板：<Typography.Text code>{resolveActiveSearchTemplate(config)}</Typography.Text>
    </Typography.Paragraph>
  </Card></>
}

function AIProviderSettings() {
  const [messageApi, contextHolder] = message.useMessage()
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [form] = Form.useForm<ProviderFormValues>()
  const activeType: AIProviderType | undefined = Form.useWatch('type', form)
  const editingId = Form.useWatch('id', form)

  async function refresh() { setProviders(await listAIProviders()) }

  useEffect(() => { void refresh() }, [])

  // When the user switches provider type on a *new* (non-editing) form, prefill
  // the Base URL with the vendor's default endpoint and seed the model field
  // with the vendor's recommended default. We skip this when editing an existing
  // provider so we never overwrite saved values.
  useEffect(() => {
    if (!activeType || editingId) return
    const preset = PROVIDER_PRESETS[activeType]
    const current = form.getFieldsValue(['baseUrl', 'model'])
    form.setFieldsValue({
      baseUrl: current.baseUrl?.trim() ? current.baseUrl : preset.baseUrl,
      model: current.model?.trim() ? current.model : preset.defaultModel,
      embeddingModel: preset.embeddingModel,
    })
  }, [activeType, editingId, form])

  function handleProviderTypeChange(type: AIProviderType) {
    const preset = PROVIDER_PRESETS[type]
    form.setFieldsValue({
      type,
      baseUrl: preset.baseUrl,
      model: preset.defaultModel,
      embeddingModel: preset.embeddingModel,
    })
    form.validateFields(['baseUrl', 'model']).catch(() => undefined)
  }

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

  async function handleTest(provider: AIProvider) {
    const key = `test-${provider.id}`
    messageApi.open({ key, type: 'loading', content: '正在测试连接…', duration: 0 })
    try {
      const result = await aiTestProvider(provider.id)
      if (result.ok) {
        messageApi.open({ key, type: 'success', content: `${result.message}（${result.endpoint}）`, duration: 3 })
      } else {
        messageApi.open({ key, type: 'error', content: result.message, duration: 3 })
      }
    } catch (error) {
      messageApi.open({ key, type: 'error', content: error instanceof Error ? error.message : '测试失败', duration: 3 })
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

  async function handleTestCurrent() {
    setTesting(true)
    const key = 'test-current-provider'
    try {
      const values = await form.validateFields()
      messageApi.open({ key, type: 'loading', content: '正在保存并测试连接…', duration: 0 })
      const saved = await saveAIProvider({
        id: values.id,
        type: values.type,
        baseUrl: values.baseUrl.trim(),
        model: values.model.trim(),
        embeddingModel: values.embeddingModel?.trim() || undefined,
        timeoutSeconds: values.timeoutSeconds,
        apiKey: values.apiKey?.trim() || undefined,
        clearApiKey: false,
      })
      form.setFieldValue('id', saved.id)
      await refresh()
      const result = await aiTestProvider(saved.id)
      messageApi.open({
        key,
        type: result.ok ? 'success' : 'error',
        content: result.ok ? `${result.message}（${result.endpoint}）` : result.message,
        duration: 4,
      })
    } catch (error) {
      messageApi.open({ key, type: 'error', content: error instanceof Error ? error.message : '测试失败', duration: 4 })
    } finally {
      setTesting(false)
    }
  }

  return <>{contextHolder}<Card title="AI Provider" className="settings-card"><Typography.Paragraph type="secondary">连接兼容 Provider，用于摘要、翻译和知识问答。普通配置写入本地 SQLite，API Key 通过操作系统密钥环保存；前端不会回显 Key 明文。</Typography.Paragraph>
    <Form form={form} layout="vertical" initialValues={{type:'openai-compatible',timeoutSeconds:60}} onFinish={handleSubmit}>
      <Space wrap>
        <Form.Item name="type" label="Provider 类型" rules={[{required:true}]}><Select options={PROVIDER_OPTIONS} style={{minWidth:220}} onChange={handleProviderTypeChange}/></Form.Item>
        <Form.Item name="baseUrl" label="Base URL" rules={[{required:true,message:'请输入 Base URL'},{type:'url',message:'需为有效 http(s) URL'}]}><Input placeholder="https://api.example.com/v1" style={{minWidth:280}}/></Form.Item>
        <Form.Item name="model" label="模型" rules={[{required:true,message:'请输入模型名称'}]}>
          {activeType === 'minimax'
            ? <Select options={MINIMAX_MODEL_OPTIONS} style={{minWidth:250}}/>
            : <Input placeholder={activeType ? PROVIDER_PRESETS[activeType].placeholderModel : 'Qwen/Qwen3.6-27B'} style={{minWidth:250}}/>}
        </Form.Item>
        <Form.Item name="embeddingModel" label="Embedding 模型（可选）"><Input placeholder={activeType ? PROVIDER_PRESETS[activeType].embeddingPlaceholder : 'text-embedding-3-small'} style={{minWidth:220}}/></Form.Item>
        <Form.Item name="timeoutSeconds" label="超时（秒）" rules={[{type:'number',min:1,max:600,message:'范围 1-600'}]}><InputNumber min={1} max={600} style={{width:120}}/></Form.Item>
        <Form.Item name="apiKey" label={activeType === 'ollama' ? 'API Key（可选）' : 'API Key'} tooltip="已保存的 Key 不会回显，留空表示不清除"><Input.Password prefix={<KeyOutlined/>} placeholder={activeType === 'ollama' ? '本地服务通常不需要' : 'sk-...'} style={{minWidth:260}} autoComplete="off"/></Form.Item>
      </Space>
      <Space>
        <Button type="primary" htmlType="submit" icon={<SaveOutlined/>} loading={saving}>保存到密钥环</Button>
        <Button icon={<ThunderboltOutlined/>} loading={testing} onClick={() => void handleTestCurrent()}>测试连接</Button>
        <Button onClick={()=>form.resetFields()}>清空</Button>
      </Space>
    </Form>
    <Typography.Title level={4} style={{marginTop:24}}>已配置 Provider</Typography.Title>
    {providers.length === 0
      ? <Typography.Text type="secondary">尚未配置。</Typography.Text>
      : <List size="small" dataSource={providers} renderItem={provider => <List.Item key={provider.id} actions={[<Button size="small" icon={<ThunderboltOutlined/>} onClick={()=>void handleTest(provider)}>测试连接</Button>,<Button size="small" onClick={()=>void handleEdit(provider)}>编辑</Button>,<Button size="small" danger icon={<DeleteOutlined/>} onClick={()=>void handleDelete(provider)}>删除</Button>]}>
          <List.Item.Meta title={<Space><Tag color={PROVIDER_TAG_COLOR[provider.type]}>{provider.type}</Tag><span>{provider.model}</span><Tag>{provider.baseUrl}</Tag>{provider.hasApiKey && <Tag color="green" icon={<KeyOutlined/>}>密钥已配置</Tag>}</Space>} description={`超时 ${provider.timeoutSeconds}s${provider.embeddingModel ? ` · embedding ${provider.embeddingModel}` : ''} · 更新于 ${new Date(provider.updatedAt).toLocaleString()}`}/>
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

const PERMISSION_LABELS: Record<SitePermissionKind, string> = {
  camera: '摄像头',
  microphone: '麦克风',
  location: '位置',
  notifications: '通知',
  clipboard: '读取剪贴板',
}

function PrivacySettings() {
  const [messageApi, contextHolder] = message.useMessage()
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([])
  const [cleanupOnExit, setCleanupOnExit] = useState<boolean>(() => readCleanupOnExitPreference())

  useEffect(() => {
    let active = true
    void listBrowserHistory().then(entries => {
      if (active) setHistoryEntries(entries)
    })
    return () => { active = false }
  }, [])

  async function clearHistory(scope: 'hour' | 'day' | 'week' | 'all') {
    const all = historyEntries
    if (scope === 'all') {
      await clearBrowserHistory()
      setHistoryEntries([])
      window.dispatchEvent(new CustomEvent<HistoryEntry[]>(HISTORY_CHANGE_EVENT, { detail: [] }))
      messageApi.success(`已清理全部 ${all.length} 条浏览记录`)
      return
    }
    const cutoff = cutoffForScope(scope)
    const next = all.filter(item => item.visitedAt < cutoff)
    await clearBrowserHistory(cutoff)
    setHistoryEntries(next)
    window.dispatchEvent(new CustomEvent<HistoryEntry[]>(HISTORY_CHANGE_EVENT, { detail: next }))
    messageApi.success(`已清理 ${all.length - next.length} 条浏览记录`)
  }

  function clearDownloads() {
    try {
      localStorage.removeItem('browser.downloads.v1')
    } catch { /* ignore */ }
    messageApi.success('已清空下载记录（磁盘文件未删除）')
  }

  function clearClosedTabs() {
    try {
      localStorage.removeItem('browser.closed')
    } catch { /* ignore */ }
    void clearClosedTabsInDb()
    messageApi.success('已清空最近关闭列表')
  }

  function clearAllPermissions() {
    try {
      localStorage.removeItem('browser.sitePermissions.v2')
    } catch { /* ignore */ }
    void replaceSitePermissions([])
    messageApi.success('已重置所有站点权限规则')
  }

  function toggleCleanupOnExit(next: boolean) {
    setCleanupOnExit(next)
    writeCleanupOnExitPreference(next)
    messageApi.success(next ? '退出时将自动清理浏览痕迹' : '已关闭退出清理')
  }

  const privateContent = <div className="privacy-section">
    <Alert type="info" showIcon message="私密标签已就绪" description="通过工具栏「⋯ → 新建私密窗口」打开；私密窗口不会写入历史、关闭列表或下载数据库。" />
    <Typography.Paragraph type="secondary">私密标签关闭后不会出现在最近关闭列表，也不会参与会话恢复。</Typography.Paragraph>
  </div>

  const historyContent = <div className="privacy-section">
    <Typography.Paragraph type="secondary">按时间范围清理浏览历史（只删数据，不会删除已保存到知识库的文档）。</Typography.Paragraph>
    <Space wrap>
      <Button onClick={() => void clearHistory('hour')}>最近 1 小时</Button>
      <Button onClick={() => void clearHistory('day')}>最近 24 小时</Button>
      <Button onClick={() => void clearHistory('week')}>最近 7 天</Button>
      <Button danger onClick={() => void clearHistory('all')}>清空全部</Button>
    </Space>
    <div className="privacy-history-head"><Typography.Text strong>全部记录</Typography.Text><Typography.Text type="secondary">{historyEntries.length} 条</Typography.Text></div>
    <List className="privacy-history-list" size="small" dataSource={historyEntries} locale={{ emptyText: '暂无浏览历史' }} renderItem={item => <List.Item key={`${item.url}-${item.visitedAt}`}><List.Item.Meta title={item.title || item.url} description={<><Typography.Text type="secondary">{new Date(item.visitedAt).toLocaleString()}</Typography.Text><Typography.Text className="privacy-history-url" copyable={{ text: item.url }}>{item.url}</Typography.Text></>}/></List.Item>}/>
  </div>

  const cleanupContent = <div className="privacy-section">
    <Typography.Paragraph type="secondary">清理浏览器生成的辅助数据，不会删除知识库文档或磁盘中的下载文件。</Typography.Paragraph>
    <Space wrap>
      <Button onClick={clearClosedTabs}>清空最近关闭</Button>
      <Button onClick={clearDownloads}>清空下载记录</Button>
      <Button onClick={clearAllPermissions}>重置所有站点权限</Button>
    </Space>
  </div>

  const exitContent = <div className="privacy-section">
    <Typography.Paragraph type="secondary">控制应用正常退出时是否自动清理本地浏览痕迹。</Typography.Paragraph>
    <Space align="start">
      <Switch checked={cleanupOnExit} onChange={toggleCleanupOnExit} />
      <Typography.Text>退出时清空浏览历史 / 最近关闭 / 下载记录（保留私密窗口未关闭时已持久化的内容）</Typography.Text>
    </Space>
  </div>

  return <>{contextHolder}<Card title="隐私与站点数据" className="settings-card privacy-settings-card"><Tabs className="privacy-section-tabs" defaultActiveKey="history" destroyOnHidden={false} items={[
    { key: 'private', label: '私密浏览', children: privateContent },
    { key: 'history', label: `浏览历史 ${historyEntries.length}`, children: historyContent },
    { key: 'cleanup', label: '数据清理', children: cleanupContent },
    { key: 'exit', label: '退出时', children: exitContent },
  ]}/></Card></>
}

const CLEANUP_ON_EXIT_KEY = 'browser.cleanupOnExit.v1'

function readCleanupOnExitPreference(): boolean {
  try {
    return localStorage.getItem(CLEANUP_ON_EXIT_KEY) === 'true'
  } catch {
    return false
  }
}

function writeCleanupOnExitPreference(value: boolean): void {
  try {
    localStorage.setItem(CLEANUP_ON_EXIT_KEY, value ? 'true' : 'false')
  } catch { /* ignore */ }
}

function cutoffForScope(scope: 'hour' | 'day' | 'week'): number {
  const now = Date.now()
  if (scope === 'hour') return now - 60 * 60 * 1000
  if (scope === 'day') return now - 24 * 60 * 60 * 1000
  return now - 7 * 24 * 60 * 60 * 1000
}

function PluginSettings() {
  const [enabled, setEnabled] = useState(isTrackingCleanerEnabled)
  const [adBlockEnabled, setAdBlockEnabledState] = useState(isAdBlockerEnabled)

  function toggle(next: boolean) {
    setEnabled(next)
    setTrackingCleanerEnabled(next)
  }

  function toggleAdBlock(next: boolean) {
    setAdBlockEnabledState(next)
    setAdBlockerEnabled(next)
    void setNativeAdBlocking(next).catch(() => undefined)
  }

  return <Card title="插件" className="settings-card plugin-settings">
    <Alert type="info" showIcon message="内置示例插件" description="该插件用于演示插件的状态、权限和启停流程；开关会真实影响浏览器导航。"/>
    <List className="plugin-list" itemLayout="horizontal" dataSource={[{ id: 'com.arcadia.tracking-cleaner', name: '链接净化器', version: '0.1.0' }]} renderItem={plugin => <List.Item actions={[<Switch key="enabled" checked={enabled} onChange={toggle}/>]}><List.Item.Meta title={<Space><Typography.Text strong>{plugin.name}</Typography.Text><Tag color="blue">示例</Tag><Tag>{enabled ? '已启用' : '已停用'}</Tag></Space>} description={<div className="plugin-description"><Typography.Paragraph>打开网页前自动移除 utm_*、fbclid、gclid 等常见跟踪参数，同时保留页面正常查询参数。</Typography.Paragraph><Space wrap><Typography.Text type="secondary">{plugin.id} · v{plugin.version}</Typography.Text><Tag>读取导航地址</Tag><Tag>修改导航地址</Tag></Space></div>}/></List.Item>}/>
    <List className="plugin-list" itemLayout="horizontal" dataSource={[{ id: 'com.arcadia.ad-blocker', name: '广告过滤器', version: '0.1.0' }]} renderItem={plugin => <List.Item actions={[<Switch key="enabled" checked={adBlockEnabled} onChange={toggleAdBlock}/>]}><List.Item.Meta title={<Space><Typography.Text strong>{plugin.name}</Typography.Text><Tag color="green">内置</Tag><Tag>{adBlockEnabled ? '已启用' : '已停用'}</Tag></Space>} description={<div className="plugin-description"><Typography.Paragraph>过滤常见广告域名和广告元素；工具栏盾牌显示当前会话实际过滤数量。关闭后立即停止页面过滤。</Typography.Paragraph><Space wrap><Typography.Text type="secondary">{plugin.id} · v{plugin.version}</Typography.Text><Tag>读取页面资源</Tag><Tag>隐藏广告元素</Tag></Space></div>}/></List.Item>}/>
  </Card>
}

function AdvancedSettingsPanel() {
  const [settings, setSettings] = useState<AdvancedSettings>(readAdvancedSettings)
  const [capabilities, setCapabilities] = useState<BrowserCapabilities | null>(null)

  useEffect(() => { void getBrowserCapabilities().then(setCapabilities) }, [])

  function update(patch: Partial<AdvancedSettings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    writeAdvancedSettings(next)
  }

  function reset() {
    setSettings(DEFAULT_ADVANCED_SETTINGS)
    writeAdvancedSettings(DEFAULT_ADVANCED_SETTINGS)
  }

  return <Card title="高级设置" className="settings-card advanced-settings">
    <div className="advanced-setting-row"><div><Typography.Text strong>活动网页上限</Typography.Text><Typography.Paragraph type="secondary">超过上限的后台标签页会休眠，重新选中时自动恢复，以降低内存占用。</Typography.Paragraph></div><InputNumber min={2} max={16} value={settings.maxLiveWebviews} onChange={value => update({ maxLiveWebviews: value ?? 8 })}/></div>
    <div className="advanced-setting-row"><div><Typography.Text strong>减少界面动画</Typography.Text><Typography.Paragraph type="secondary">关闭页面切换位移和侧栏动效，适合低性能设备或偏好静态界面。</Typography.Paragraph></div><Switch checked={settings.reduceMotion} onChange={value => update({ reduceMotion: value })}/></div>
    <div className="advanced-setting-row"><div><Typography.Text strong>危险地址提醒</Typography.Text><Typography.Paragraph type="secondary">在地址包含可疑协议、凭据或不安全 HTTP 时显示提醒。</Typography.Paragraph></div><Switch checked={settings.safetyWarnings} onChange={value => update({ safetyWarnings: value })}/></div>
    <div className="advanced-setting-row"><div><Typography.Text strong>空闲自动休眠</Typography.Text><Typography.Paragraph type="secondary">超过设定分钟数未访问的标签页会被列入休眠候选；固定标签、有音频、或正在下载的标签页会豁免。</Typography.Paragraph></div><InputNumber min={1} max={180} value={settings.idleSuspendMinutes} addonAfter="分钟" onChange={value => update({ idleSuspendMinutes: value ?? 30 })}/></div>
    <div className="advanced-setting-row"><div><Typography.Text strong>后台标签轮询</Typography.Text><Typography.Paragraph type="secondary">关闭后非活动标签完全停止轮询，仅在切换时刷新状态；适合极低功耗设备。</Typography.Paragraph></div><Switch checked={settings.backgroundPollingEnabled} onChange={value => update({ backgroundPollingEnabled: value })}/></div>
    <div className="advanced-setting-row"><div><Typography.Text strong>后台轮询频率</Typography.Text><Typography.Paragraph type="secondary">后台标签状态同步的频率，越小越实时但 CPU 越高。</Typography.Paragraph></div><InputNumber min={1000} max={15000} step={500} value={settings.backgroundPollIntervalMs} addonAfter="ms" onChange={value => update({ backgroundPollIntervalMs: value ?? 3000 })} disabled={!settings.backgroundPollingEnabled}/></div>
    <Typography.Title level={5} style={{ marginTop: 26 }}>运行环境诊断</Typography.Title>
    <Descriptions size="small" bordered column={2} items={[
      { key: 'runtime', label: 'Tauri', children: capabilities?.tauriRuntimeVersion ?? '网页预览模式' },
      { key: 'backend', label: 'WebView', children: capabilities?.webviewBackend ?? '不可用' },
      { key: 'downloads', label: '下载进度', children: capabilities?.downloadProgressBytes ? '支持' : '基础模式' },
      { key: 'permissions', label: '原生权限事件', children: capabilities?.nativePermissionEvents ? '支持' : '脚本兼容模式' },
    ]}/>
    <Button style={{ marginTop: 18 }} onClick={reset}>恢复高级设置默认值</Button>
  </Card>
}

export function SettingsPage() {
  const items = ['通用','浏览器','隐私','AI Provider','知识库','插件','高级'].map((label, index) => ({
    key: label,
    label,
    children: index === 0 ? <GeneralSettings/> : index === 1 ? <BrowserSettings/> : index === 2 ? <PrivacySettings/> : index === 3 ? <AIProviderSettings/> : index === 4 ? <KnowledgeBaseSettings/> : index === 5 ? <PluginSettings/> : <AdvancedSettingsPanel/>,
  }))
  return <section className="page"><PageHeader eyebrow="PREFERENCES" title="设置" description="调整浏览器、隐私、AI Provider 与知识库工作流。"/><Tabs tabPosition="left" items={items} defaultActiveKey="通用"/></section>
}
