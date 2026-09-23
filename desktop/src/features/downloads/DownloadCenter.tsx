import { useMemo, useState } from 'react'
import { Typography } from 'antd'
import { Button, Empty, List, Popconfirm, Progress, Space, Table, Tag, Tooltip, type TableColumn } from '../../components/ui'
import { CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, ExclamationCircleOutlined, FileOutlined, FolderOpenOutlined, LoadingOutlined, MinusCircleOutlined, PauseOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons'
import type { DownloadRecord } from '../../services/downloads'
import { fileNameOf } from '../../services/downloads'
import type { UseDownloadCenterResult } from './useDownloadCenter'

export interface DownloadCenterProps {
  center: UseDownloadCenterResult
  /** Optional upper bound; default 200 (Library tab default). */
  limit?: number
}

const STATUS_LABEL: Record<DownloadRecord['status'], string> = {
  queued: '等待中',
  downloading: '下载中',
  paused: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
  failed: '失败',
  blocked: '已拦截',
}

const DANGER_LABEL: Record<DownloadRecord['dangerType'], string> = {
  none: '安全',
  executable: '可执行',
  script: '脚本',
  archive: '压缩包',
  document: '文档',
  other: '其他',
}

const DANGER_COLOR: Record<DownloadRecord['dangerType'], string> = {
  none: 'green',
  executable: 'red',
  script: 'volcano',
  archive: 'blue',
  document: 'geekblue',
  other: 'default',
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatRelative(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso
  const diff = Math.max(0, Date.now() - then)
  if (diff < 60_000) return `${Math.round(diff / 1000)} 秒前`
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`
  return `${Math.round(diff / 86_400_000)} 天前`
}

function statusIcon(status: DownloadRecord['status']) {
  switch (status) {
    case 'completed': return <CheckCircleOutlined className="is-success" />
    case 'failed': return <CloseCircleOutlined className="is-error" />
    case 'cancelled': return <MinusCircleOutlined />
    case 'blocked': return <ExclamationCircleOutlined className="is-error" />
    case 'downloading': return <LoadingOutlined spin />
    default: return <FileOutlined />
  }
}

function isTerminal(status: DownloadRecord['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'blocked'
}

/**
 * Full download history panel. Used by the Library page's "下载" tab. The
 * toolbar popover renders its own narrower view via {@link DownloadSummary}.
 */
export function DownloadCenter({ center, limit = 200 }: DownloadCenterProps) {
  const { records, hydrated, remove, open, reveal, pause, cancel, retry } = center
  const filtered = useMemo(() => records.slice(0, limit), [records, limit])
  const [busyId, setBusyId] = useState<string | null>(null)

  if (!hydrated) {
    return <Typography.Text type="secondary">加载中…</Typography.Text>
  }

  if (filtered.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有下载记录" />
  }

  const columns = [
    {
      title: '文件',
      dataIndex: 'fileName',
      key: 'fileName',
      render: (_, record) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong ellipsis={{ tooltip: fileNameOf(record) }} style={{ maxWidth: 320 }}>
            {fileNameOf(record)}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.sourceOrigin ?? record.url}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (_, record) => (
        <Space size={6}>
          {statusIcon(record.status)}
          <span>{STATUS_LABEL[record.status]}</span>
        </Space>
      ),
    },
    {
      title: '进度',
      key: 'progress',
      width: 180,
      render: (_, record) => {
        if (record.status === 'completed') {
          return <Typography.Text type="success">{formatBytes(record.totalBytes ?? record.receivedBytes)}</Typography.Text>
        }
        if (record.status === 'downloading' || record.status === 'paused' || record.status === 'queued') {
          const total = record.totalBytes ?? 0
          const percent = total > 0 ? Math.min(100, Math.round((record.receivedBytes / total) * 100)) : 0
          return (
            <Progress
              percent={total > 0 ? percent : 100}
              status={record.status === 'paused' ? 'normal' : 'active'}
              format={() => total > 0 ? `${percent}%` : '不确定'}
              size="small"
            />
          )
        }
        if (record.errorMessage) {
          return <Tooltip title={record.errorMessage}><Typography.Text type="danger">{record.errorMessage}</Typography.Text></Tooltip>
        }
        return <Typography.Text type="secondary">—</Typography.Text>
      },
    },
    {
      title: '大小',
      key: 'size',
      width: 130,
      render: (_, record) => (
        <Typography.Text type="secondary">
          {formatBytes(record.receivedBytes)} / {formatBytes(record.totalBytes)}
        </Typography.Text>
      ),
    },
    {
      title: '风险',
      dataIndex: 'dangerType',
      key: 'danger',
      width: 90,
      render: (_, record) => record.dangerType === 'none'
        ? <Typography.Text type="secondary">—</Typography.Text>
        : <Tag color={DANGER_COLOR[record.dangerType]}>{DANGER_LABEL[record.dangerType]}</Tag>,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 110,
      render: (_, record) => <Typography.Text type="secondary">{formatRelative(record.updatedAt)}</Typography.Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 170,
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="打开文件">
            <Button
              size="small"
              type="text"
              icon={<FileOutlined />}
              disabled={!isTerminal(record.status) || record.status === 'cancelled' || !record.targetPath}
              loading={busyId === record.id}
              onClick={async () => { setBusyId(record.id); try { await open(record.id) } finally { setBusyId(null) } }}
            />
          </Tooltip>
          <Tooltip title="打开所在文件夹">
            <Button
              size="small"
              type="text"
              icon={<FolderOpenOutlined />}
              disabled={!record.targetPath}
              loading={busyId === record.id}
              onClick={async () => { setBusyId(record.id); try { await reveal(record.id) } finally { setBusyId(null) } }}
            />
          </Tooltip>
          {record.status === 'downloading' && (
            <Tooltip title="暂停（保留已下载的部分）">
              <Button
                size="small"
                type="text"
                icon={<PauseOutlined />}
                loading={busyId === record.id}
                onClick={async () => { setBusyId(record.id); try { await pause(record.id) } finally { setBusyId(null) } }}
              />
            </Tooltip>
          )}
          {record.status === 'paused' && (
            <Tooltip title="重试（从头开始）">
              <Button
                size="small"
                type="text"
                icon={<ReloadOutlined />}
                loading={busyId === record.id}
                onClick={async () => { setBusyId(record.id); try { await retry(record.id) } finally { setBusyId(null) } }}
              />
            </Tooltip>
          )}
          {(record.status === 'downloading' || record.status === 'paused' || record.status === 'queued') && (
            <Tooltip title="取消下载">
              <Button
                size="small"
                type="text"
                danger
                icon={<StopOutlined />}
                loading={busyId === record.id}
                onClick={async () => { setBusyId(record.id); try { await cancel(record.id) } finally { setBusyId(null) } }}
              />
            </Tooltip>
          )}
          {(record.status === 'failed' || record.status === 'cancelled' || record.status === 'blocked') && (
            <Tooltip title="重试">
              <Button
                size="small"
                type="text"
                icon={<ReloadOutlined />}
                loading={busyId === record.id}
                onClick={async () => { setBusyId(record.id); try { await retry(record.id) } finally { setBusyId(null) } }}
              />
            </Tooltip>
          )}
          <Popconfirm
            title="移除这条记录？"
            description="可同时删除磁盘上的文件"
            okText="仅移除记录"
            cancelText="取消"
            onConfirm={async () => { setBusyId(record.id); try { await remove(record.id, false) } finally { setBusyId(null) } }}
          >
            <Button size="small" type="text" icon={<DeleteOutlined />} />
          </Popconfirm>
          <Popconfirm
            title="删除下载文件？"
            description="会同时删除磁盘文件，不可撤销"
            okText="删除文件"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            disabled={!record.targetPath}
            onConfirm={async () => { setBusyId(record.id); try { await remove(record.id, true) } finally { setBusyId(null) } }}
          >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ] satisfies TableColumn<DownloadRecord>[]

  return (
    <Table<DownloadRecord>
      rowKey="id"
      dataSource={filtered}
      columns={columns}
      size="small"
      pagination={{ pageSize: 20, showSizeChanger: false }}
      rowClassName={record => record.private ? 'download-row download-row--private' : 'download-row'}
    />
  )
}

/**
 * Lightweight toolbar popover: top-N live entries plus a "more" link that
 * jumps to the Library "下载" tab. Always shows the badge count of in-flight
 * downloads even when the popover is closed.
 */
export function DownloadSummary({
  feed,
  inFlight,
}: {
  feed: UseDownloadCenterResult['feed']
  inFlight: number
}) {
  const items = feed.slice(0, 5)
  return (
    <div className="browser-downloads">
      <div className="browser-downloads__head">
        <b>下载</b>
        <Typography.Text type="secondary">
          {inFlight > 0 ? `${inFlight} 个正在下载` : '暂无活动'}
        </Typography.Text>
      </div>
      {items.length === 0
        ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无下载" />
        : (
          <List
            size="small"
            dataSource={items}
            renderItem={item => {
              const name = fileNameOf(item)
              return (
                <List.Item>
                  <List.Item.Meta
                    avatar={statusIcon(item.status as DownloadRecord['status'])}
                    title={<Typography.Text ellipsis={{ tooltip: name }}>{name}</Typography.Text>}
                    description={
                      <Typography.Text type="secondary">
                        {STATUS_LABEL[item.status as DownloadRecord['status']] ?? item.status}
                        {item.totalBytes ? ` · ${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}` : ''}
                      </Typography.Text>
                    }
                  />
                </List.Item>
              )
            }}
          />
        )}
    </div>
  )
}
