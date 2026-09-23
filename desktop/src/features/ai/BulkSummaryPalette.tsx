import { useMemo, useState } from 'react'
import { Typography } from 'antd'
import { Alert, Button, Input, List, Modal, Progress, Segmented, Space, Tag } from '../../components/ui'
import type { BulkProgressEntry } from './bulkSummary'
import { summaryKindLabelSafe } from './bulkSummary'
import type { SummaryKind } from './summarize'

export interface BulkSummaryPaletteProps {
  open: boolean
  onClose: () => void
  onRun: (urls: string[], kind: SummaryKind) => Promise<BulkProgressEntry[]>
  busy: boolean
  progress: BulkProgressEntry[]
}

const SUMMARY_KINDS: SummaryKind[] = ['one-sentence', 'short', 'detailed', 'key-points']

function parseUrls(raw: string): string[] {
  return raw.split(/\r?\n/).map(line => line.trim()).filter(line => /^https?:\/\//i.test(line))
}

export function BulkSummaryPalette({ open, onClose, onRun, busy, progress }: BulkSummaryPaletteProps) {
  const [raw, setRaw] = useState('')
  const [kind, setKind] = useState<SummaryKind>('short')
  const urls = useMemo(() => parseUrls(raw), [raw])
  const stats = useMemo(() => {
    let fetched = 0, summarised = 0, failed = 0, skipped = 0
    for (const entry of progress) {
      if (entry.status === 'fetched') fetched += 1
      else if (entry.status === 'summarised') summarised += 1
      else if (entry.status === 'failed') failed += 1
      else if (entry.status === 'skipped') skipped += 1
    }
    return { fetched, summarised, failed, skipped }
  }, [progress])
  const total = progress[progress.length - 1]?.total ?? urls.length
  const completed = progress.length
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100)
  const finished = total > 0 && completed >= total

  async function start() {
    if (!urls.length) return
    await onRun(urls, kind)
  }

  return <Modal
    open={open}
    onCancel={onClose}
    footer={null}
    width={680}
    destroyOnHidden
    title={null}
    styles={{ body: { padding: 0 } }}
  >
    <div className="bulk-summary-palette">
      <Typography.Title level={5} style={{ margin: '0 0 8px' }}>多链接 AI 摘要</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        每行一个 URL（仅 http/https）。每个页面会单独调用 AI 摘要并存为文档，最后再把所有摘要合并成一份综述。
      </Typography.Paragraph>
      <Space wrap style={{ marginBottom: 8 }}>
        <Segmented<SummaryKind>
          value={kind}
          onChange={value => setKind(value as SummaryKind)}
          options={SUMMARY_KINDS.map(option => ({ label: summaryKindLabelSafe(option), value: option }))}
        />
        <Typography.Text type="secondary">识别到 {urls.length} 个 URL</Typography.Text>
      </Space>
      <Input.TextArea
        value={raw}
        onChange={event => setRaw(event.target.value)}
        placeholder={'https://example.com/article-1\nhttps://example.com/article-2'}
        autoSize={{ minRows: 5, maxRows: 10 }}
        spellCheck={false}
      />
      <Space style={{ marginTop: 12 }}>
        <Button type="primary" loading={busy} disabled={!urls.length || finished} onClick={start}>开始 AI 摘要</Button>
        <Button onClick={onClose} disabled={busy}>关闭</Button>
      </Space>
      {(busy || progress.length > 0) && <>
        <Progress percent={percent} status={finished ? (stats.failed > 0 ? 'exception' : 'success') : 'active'} style={{ marginTop: 16 }} />
        <Typography.Text type="secondary">完成 {completed} / {total} · 摘要 {stats.summarised} · 跳过 {stats.skipped} · 失败 {stats.failed}</Typography.Text>
        {progress.length > 0 && <List
          size="small"
          style={{ marginTop: 12, maxHeight: 220, overflow: 'auto' }}
          dataSource={progress}
          renderItem={(entry) => <List.Item>
            <List.Item.Meta
              title={<>
                <Typography.Text>{entry.title || entry.url}</Typography.Text>
                {entry.status === 'summarised' && <Tag color="green" style={{ marginLeft: 6 }}>已存入</Tag>}
                {entry.status === 'skipped' && <Tag color="orange" style={{ marginLeft: 6 }}>跳过</Tag>}
                {entry.status === 'failed' && <Tag color="red" style={{ marginLeft: 6 }}>失败</Tag>}
              </>}
              description={<>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{entry.url}</Typography.Text>
                {entry.message && <Alert type="warning" showIcon message={entry.message} style={{ marginTop: 4 }} />}
              </>}
            />
          </List.Item>}
        />}
      </>}
    </div>
  </Modal>
}
