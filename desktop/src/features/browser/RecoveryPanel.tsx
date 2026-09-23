import { Button, Modal, Space, Typography } from '../../components/ui'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import type { SessionLockState } from '../../services/session'

export type RecoveryChoice = 'all' | 'pinned' | 'discard'

export interface RecoveryPanelProps {
  open: boolean
  state: SessionLockState | null
  onChoose: (choice: RecoveryChoice) => void
}

/**
 * Modal that appears when the previous run left a lock behind (crash, kill,
 * power loss). Three options:
 *   - 恢复全部 — restore every non-private tab
 *   - 仅恢复固定标签 — restore pinned tabs only
 *   - 放弃恢复 — start a fresh tab; the lock is cleared either way
 */
export function RecoveryPanel({ open, state, onChoose }: RecoveryPanelProps) {
  if (!state) return null
  const ageMinutes = Math.max(0, Math.round((Date.now() / 1000 - state.updatedAt) / 60))
  return (
    <Modal
      title={
        <Space>
          <ExclamationCircleOutlined style={{ color: '#faad14' }} />
          <span>检测到上一次会话异常退出</span>
        </Space>
      }
      open={open}
      closable={false}
      mask={{ closable: false }}
      footer={null}
      width={520}
    >
      <Typography.Paragraph>
        上次会话约 <b>{ageMinutes} 分钟前</b> 未正常结束（崩溃 / 强杀 / 断电）。请选择如何恢复：
      </Typography.Paragraph>
      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        <Button block type="primary" onClick={() => onChoose('all')}>
          恢复全部标签
        </Button>
        <Button block onClick={() => onChoose('pinned')}>
          仅恢复固定标签
        </Button>
        <Button block danger onClick={() => onChoose('discard')}>
          放弃恢复，从新标签开始
        </Button>
      </Space>
    </Modal>
  )
}
