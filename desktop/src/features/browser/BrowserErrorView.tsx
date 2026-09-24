import { Button, Space, Typography } from '../../components/ui'
import { CopyOutlined, PlusOutlined, ReloadOutlined } from '../../components/ui/icons'
import type { BrowserTab } from '../../types'

export function BrowserErrorView({ tab, onRetry, onNewTab, onCopy }: {
  tab: BrowserTab
  onRetry: () => void
  onNewTab: () => void
  onCopy: () => void
}) {
  const error = tab.error
  const kind = error?.kind ?? 'load-failed'
  const message = error?.message ?? '未知错误'
  const title = kind === 'web-mode-required'
    ? '请在 Tauri 桌面应用中打开网页'
    : kind === 'unsupported-protocol'
      ? '应用不支持该协议'
      : kind === 'offline' ? '设备当前离线'
      : kind === 'dns' ? '找不到网站地址'
      : kind === 'timeout' ? '连接超时'
      : kind === 'tls' ? '无法建立安全连接'
      : kind === 'connection-refused' ? '服务器拒绝连接'
      : kind === 'http-client' || kind === 'http-server' ? `服务器返回错误${error?.httpStatus ? `（${error.httpStatus}）` : ''}`
      : '无法加载该网页'
  const eyebrow = kind === 'web-mode-required'
    ? '需要桌面应用'
    : kind === 'unsupported-protocol'
      ? '协议被拦截'
      : '加载失败'
  return <div className="browser-error">
    <Typography.Text className="eyebrow">{eyebrow}</Typography.Text>
    <Typography.Title level={3}>{title}</Typography.Title>
    <Typography.Paragraph type="secondary">{message}</Typography.Paragraph>
    {tab.url && <Typography.Text code className="browser-error__url">{tab.url}</Typography.Text>}
    <Space wrap>
      {!['web-mode-required','unsupported-protocol'].includes(kind) && <Button type="primary" icon={<ReloadOutlined/>} onClick={onRetry}>重试</Button>}
      <Button icon={<PlusOutlined/>} onClick={onNewTab}>返回新标签页</Button>
      {tab.url && <Button icon={<CopyOutlined/>} onClick={onCopy}>复制 URL</Button>}
    </Space>
  </div>
}
