import { Empty, List, Tag, Typography } from '../../components/ui'
import type { AgentRun } from '../../api'

const STATUS_COLOR: Record<string, string> = {
  pending: 'default',
  running: 'blue',
  awaiting_approval: 'gold',
  completed: 'green',
  failed: 'red',
  cancelled: 'orange',
}

interface ParsedStep {
  index: number
  kind: string
  summary: string
  at: string
}

/** Parse the stored `steps_json` column, tolerating malformed history rows. */
export function parseAgentSteps(stepsJson: string): ParsedStep[] {
  try {
    const value: unknown = JSON.parse(stepsJson || '[]')
    return Array.isArray(value) ? (value as ParsedStep[]) : []
  } catch {
    return []
  }
}

/**
 * Read-only view of the persisted `agent_runs` rows.
 *
 * Each run shows its recorded steps so a user can audit what the agent did
 * rather than only seeing the final answer.
 */
export function AgentRunHistory({ runs }: { runs: readonly AgentRun[] }) {
  if (runs.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Agent 运行记录" />
  }
  return <List
    dataSource={[...runs]}
    renderItem={run => (
      <List.Item>
        <List.Item.Meta
          title={<Typography.Text strong>{run.title || '(无标题)'}</Typography.Text>}
          description={
            <div className="agent-run-steps">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {run.startedAt}
              </Typography.Text>
              <div>
                <Tag color={STATUS_COLOR[run.status] ?? 'default'}>{run.status}</Tag>
              </div>
              {parseAgentSteps(run.stepsJson).map(step => (
                <Typography.Text key={`${run.id}-${step.index}`} style={{ fontSize: 12 }}>
                  {step.index}. [{step.kind}] {step.summary}
                </Typography.Text>
              ))}
              {run.lastError && (
                <Typography.Text type="danger" style={{ fontSize: 12 }}>{run.lastError}</Typography.Text>
              )}
              {run.finalAnswer && (
                <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0, fontSize: 12 }}>
                  {run.finalAnswer}
                </Typography.Paragraph>
              )}
            </div>
          }
        />
      </List.Item>
    )}
  />
}