import { Alert, Button, Empty, Space, Table, Tag, Typography, message } from '../../components/ui'
import { ReloadOutlined } from '../../components/ui/icons'
import { useCallback, useEffect, useState } from 'react'
import { getMigrationStatus, listStoredSitePermissions, ragEnqueueAll, ragIndexStatus, ragListJobs, ragRebuildIndex, ragRetryJob, replaceSitePermissions, type MigrationStatus, type RagIndexStatus, type RagJobRow, listAIProviders } from '../../api'
import type { AIProvider } from '../../types'
import { SITE_PERMISSION_KINDS, type SitePermissionRule } from '../browser/sitePermissions'

const DECISION_COLOR: Record<string, string> = { allow: 'green', deny: 'red', ask: 'gold' }

/**
 * Knowledge-base health: schema version plus the stored site permission rules.
 *
 * `listStoredSitePermissions` reads the database rather than localStorage, so
 * this is the view that tells the user what the app will actually enforce.
 */
export function KnowledgeBaseStatusPanel() {
  const [messageApi, contextHolder] = message.useMessage()
  const [status, setStatus] = useState<MigrationStatus | null>(null)
  const [rules, setRules] = useState<SitePermissionRule[]>([])
  const [loading, setLoading] = useState(false)
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [ragStatus, setRagStatus] = useState<RagIndexStatus | null>(null)
  const [ragJobs, setRagJobs] = useState<RagJobRow[]>([])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextStatus, nextRules, nextProviders, nextRag, nextJobs] = await Promise.all([
        getMigrationStatus(),
        listStoredSitePermissions(),
        listAIProviders(),
        ragIndexStatus().catch(() => null),
        ragListJobs(20).catch(() => []),
      ])
      setStatus(nextStatus)
      setRules(nextRules)
      setProviders(nextProviders)
      setRagStatus(nextRag)
      setRagJobs(nextJobs ?? [])
    } catch {
      // Non-Tauri preview: nothing to report.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function resetRule(origin: string) {
    const remaining = rules.filter(rule => rule.origin !== origin)
    await replaceSitePermissions(remaining)
    setRules(remaining)
    messageApi.success(`已清除 ${origin} 的站点权限`)
  }

  async function rebuildIndex() {
    const target = providers.find(p => p.embeddingModel)
    if (!target) {
      messageApi.warning('请先在「AI Provider」中配置带 embeddingModel 的 Provider')
      return
    }
    const n = await ragRebuildIndex(target.id, target.embeddingModel ?? target.model)
    messageApi.success(`已重建索引：${n} 个文档待处理`)
    void refresh()
  }

  async function enqueueAll() {
    const target = providers.find(p => p.embeddingModel)
    if (!target) {
      messageApi.warning('请先在「AI Provider」中配置带 embeddingModel 的 Provider')
      return
    }
    const n = await ragEnqueueAll(target.id, target.embeddingModel ?? target.model)
    messageApi.success(`已入队 ${n} 篇新文档`)
    void refresh()
  }

  async function retryJob(jobId: string) {
    await ragRetryJob(jobId)
    void refresh()
  }

  return <div className="kb-status-panel">
    {contextHolder}
    <Space style={{ marginBottom: 8 }} align="center">
      <Typography.Title level={5} style={{ margin: 0 }}>知识库状态</Typography.Title>
      <Button size="small" icon={<ReloadOutlined spin={loading} />} onClick={() => void refresh()}>刷新</Button>
    </Space>
    {status
      ? <Typography.Paragraph type="secondary">
          数据库 schema 版本 <b>{status.version}</b>
          {status.pending > 0
            ? <Tag color="gold" style={{ marginLeft: 8 }}>待应用 {status.pending} 个迁移</Tag>
            : <Tag color="green" style={{ marginLeft: 8 }}>已是最新</Tag>}
        </Typography.Paragraph>
      : <Alert type="info" showIcon message="桌面端以外的环境不包含本地知识库" />}
    <Typography.Title level={5} style={{ marginTop: 16 }}>站点权限（{rules.length}）</Typography.Title>
    {rules.length === 0
      ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未记录任何站点权限" />
      : <Table<SitePermissionRule>
          size="small"
          rowKey="origin"
          dataSource={rules}
          pagination={false}
          columns={[
            { title: '站点', dataIndex: 'origin' },
            ...SITE_PERMISSION_KINDS.map(kind => ({
              title: kind,
              key: kind,
              width: 80,
              render: (_: unknown, rule: SitePermissionRule) => (
                <Tag color={DECISION_COLOR[rule[kind]] ?? 'default'}>{rule[kind]}</Tag>
              ),
            })),
            {
              title: '操作',
              key: 'actions',
              width: 90,
              render: (_: unknown, rule: SitePermissionRule) => (
                <Button size="small" danger onClick={() => void resetRule(rule.origin)}>清除</Button>
              ),
            },
          ]}
        />}

    <Typography.Title level={5} style={{ marginTop: 16 }}>RAG 索引</Typography.Title>
    {ragStatus
      ? <Space wrap>
          <Tag>总任务 {ragStatus.totalJobs}</Tag>
          <Tag color="gold">等待 {ragStatus.pending}</Tag>
          <Tag color="red">失败 {ragStatus.failed}</Tag>
          <Tag color="green">完成 {ragStatus.completed}</Tag>
          <Tag>已索引 {ragStatus.indexedDocuments}</Tag>
          {ragStatus.recovered > 0 && <Tag color="cyan">已恢复 {ragStatus.recovered}</Tag>}
        </Space>
      : <Alert type="info" showIcon message="非桌面环境，跳过 RAG 索引" />}
    <Space style={{ marginTop: 8 }} wrap>
      <Button size="small" onClick={() => void rebuildIndex()}>重建索引</Button>
      <Button size="small" onClick={() => void enqueueAll()}>入队新文档</Button>
    </Space>
    {ragJobs.length > 0 && (
      <Table<RagJobRow>
        size="small"
        style={{ marginTop: 8 }}
        rowKey="id"
        dataSource={ragJobs}
        pagination={false}
        columns={[
          { title: '文档', dataIndex: 'documentId' },
          { title: 'Provider', dataIndex: 'providerId' },
          { title: '模型', dataIndex: 'model' },
          {
            title: '状态',
            dataIndex: 'status',
            render: (status: RagJobRow['status']) => {
              const color = status === 'COMPLETED' ? 'green'
                : status === 'FAILED' ? 'red'
                : status === 'CANCELLED' ? 'default'
                : 'blue'
              return <Tag color={color}>{status}</Tag>
            },
          },
          {
            title: '操作',
            key: 'actions',
            render: (_: unknown, job: RagJobRow) => (
              <Button size="small" onClick={() => void retryJob(job.id)}>重试</Button>
            ),
          },
        ]}
      />
    )}
  </div>
}