import { Button, Space, Typography } from '../../components/ui'
import { CheckCircleOutlined, CloseCircleOutlined, SafetyCertificateOutlined } from '../../components/ui/icons'
import type { UsePermissionPromptResult } from './usePermissionPrompt'
import { describePrompt } from './usePermissionPrompt'

export interface PermissionPromptBarProps {
  prompt: UsePermissionPromptResult
}

/**
 * Inline permission bar shown beneath the address bar. Three choices per
 * the task description:
 *   - 本次允许
 *   - 始终允许
 *   - 拒绝  (default — implies deny-once)
 * Hidden when no pending request.
 */
export function PermissionPromptBar({ prompt }: PermissionPromptBarProps) {
  const { pending, decide } = prompt
  if (!pending) return null
  const { origin, kindLabel, originLabel } = describePrompt(pending)
  return (
    <div className="browser-permission-prompt" role="status">
      <SafetyCertificateOutlined className="browser-permission-prompt__icon" />
      <div className="browser-permission-prompt__body">
        <Typography.Text strong>
          {originLabel} 请求使用 {kindLabel}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
          来源：{origin}
        </Typography.Text>
      </div>
      <Space size={4}>
        <Button
          size="small"
          icon={<CheckCircleOutlined />}
          onClick={() => void decide('allow-once')}
        >
          本次允许
        </Button>
        <Button
          size="small"
          type="primary"
          icon={<CheckCircleOutlined />}
          onClick={() => void decide('allow-always')}
        >
          始终允许
        </Button>
        <Button
          size="small"
          danger
          icon={<CloseCircleOutlined />}
          onClick={() => void decide('deny-once')}
        >
          拒绝
        </Button>
      </Space>
    </div>
  )
}
