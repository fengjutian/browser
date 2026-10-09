import { Alert, Button, Empty, Space, Table, Tag, Typography, message } from '../../components/ui'
import { ReloadOutlined } from '../../components/ui/icons'
import { useCallback, useEffect, useState } from 'react'
import { getMigrationStatus, listStoredSitePermissions, replaceSitePermissions, type MigrationStatus } from '../../api'
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

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextStatus, nextRules] = await Promise.all([
        getMigrationStatus(),
        listStoredSitePermissions(),
      ])
      setStatus(nextStatus)
      setRules(nextRules)
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
  </div>
}