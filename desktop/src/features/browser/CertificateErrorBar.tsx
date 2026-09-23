import { Alert, Typography } from 'antd'
import { Button, Space } from '../../components/ui'
import { SafetyCertificateOutlined } from '@ant-design/icons'
import type { CertificateErrorPayload } from '../../services/nativeBrowser'

export interface CertificateErrorBarProps {
  payload: CertificateErrorPayload
  onRespond: (allow: boolean) => void
}

/**
 * Persistent banner that sits at the top of the browser surface while a
 * certificate failure blocks the underlying webview from loading. The user can
 * dismiss the banner (which records their deny choice with the host) or
 * pretend-allow — the latter is a no-op today because we don't yet bind to
 * WebView2's actual deferral API.
 */
export function CertificateErrorBar({ payload, onRespond }: CertificateErrorBarProps) {
  return <Alert
    banner
    type="error"
    showIcon
    icon={<SafetyCertificateOutlined />}
    message={<>
        <Typography.Text strong>证书验证被拦截：</Typography.Text>{' '}
        {payload.url || '当前网页'}
      </>}
    description={<>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
          浏览器默认拒绝展示证书无效的网页（{payload.message || '未知原因'}）。
          {payload.repeated && ' 同一站点此前已被拦截过一次，请确认后再继续。'}
        </Typography.Paragraph>
        <Space>
          <Button type="primary" danger onClick={() => onRespond(false)}>保持拦截</Button>
          <Button onClick={() => onRespond(true)}>继续访问（仍受 WebView2 默认拒绝）</Button>
        </Space>
      </>}
    closable={false}
  />
}
