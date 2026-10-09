import { describe, expect, it, vi } from 'vitest'
import type { AgentRun } from '../../api'
import { runResearchAgent, type AgentDeps, type AgentOptions } from './agentLoop'

/** Shape of the argument passed to `updateAgentRunStatus`, for assertions. */
interface StatusUpdate {
  id: string
  status: string
  stepsJson?: string
  finalAnswer?: string
  lastError?: string
}

function spyUpdates(): { spy: (input: StatusUpdate) => Promise<void>; calls: StatusUpdate[][] } {
  const calls: StatusUpdate[][] = []
  const spy = vi.fn(async (input: StatusUpdate) => { calls.push([input]) })
  return { spy, calls }
}

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'agent-1',
    title: 't',
    status: 'pending',
    stepsJson: '[]',
    startedAt: '2026-10-07T00:00:00Z',
    ...overrides,
  }
}

function deps(overrides: Partial<AgentDeps> = {}): AgentDeps & { statuses: string[] } {
  const statuses: string[] = []
  const base: AgentDeps = {
    async recordAgentRun() { return run() },
    async updateAgentRunStatus(input) { statuses.push(input.status) },
    async searchDocuments() {
      return [
        { id: 'doc-1', title: 'Doc one', markdownSnippet: 'alpha' },
        { id: 'doc-2', title: 'Doc two', markdownSnippet: 'beta' },
      ]
    },
    async aiChat() { return { content: 'final answer', promptTokens: 100 } },
    async listMcpServers() { return [] },
    async discoverMcpServer() { return {} },
    async listMcpTools() { return [] },
    async callMcpTool() { return {} },
    ...overrides,
  }
  return Object.assign(base, { statuses })
}

const options: AgentOptions = { providerId: 'p1' }

describe('runResearchAgent', () => {
  it('records a run and completes with an answer', async () => {
    const d = deps()
    const result = await runResearchAgent(d, 'what did I save?', options)

    expect(result.run?.id).toBe('agent-1')
    expect(result.answer).toBe('final answer')
    expect(result.stopped).toBeNull()
    expect(d.statuses).toContain('running')
    expect(d.statuses[d.statuses.length - 1]).toBe('completed')
    expect(result.steps.map(step => step.kind)).toEqual(['search', 'answer'])
  })

  it('persists the steps and final answer on the run row', async () => {
    const { spy, calls } = spyUpdates()
    await runResearchAgent(deps({ updateAgentRunStatus: spy }), 'q', options)

    const last = calls.at(-1)?.[0]
    expect(last?.status).toBe('completed')
    expect(last?.finalAnswer).toBe('final answer')
    expect(JSON.parse(String(last?.stepsJson)).length).toBe(2)
  })

  it('marks the run failed and keeps the error when the model call throws', async () => {
    const { spy, calls } = spyUpdates()
    const d = deps({
      updateAgentRunStatus: spy,
      async aiChat() { throw new Error('provider offline') },
    })
    const result = await runResearchAgent(d, 'q', options)

    expect(result.answer).toBe('')
    expect(result.stopped?.message).toContain('provider offline')
    const last = calls.at(-1)?.[0]
    expect(last?.status).toBe('failed')
    expect(last?.lastError).toContain('provider offline')
  })

  it('cancels the run when the token budget is exceeded', async () => {
    const { spy, calls } = spyUpdates()
    const d = deps({
      updateAgentRunStatus: spy,
      async aiChat() { return { content: 'long answer', promptTokens: 5000 } },
    })
    const result = await runResearchAgent(d, 'q', { ...options, maxPromptTokens: 100 })

    expect(result.stopped?.reason).toBe('token_budget')
    const last = calls.at(-1)?.[0]
    expect(last?.status).toBe('cancelled')
    expect(last?.finalAnswer).toBe('long answer')
  })

  it('does not call MCP tools without explicit approval', async () => {
    const callTool = vi.fn(async (_id: string, _name: string, _args: Record<string, unknown>, _ok: boolean) => ({}))
    const d = deps({
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() { return [{ name: 'search_web' }] },
      callMcpTool: callTool,
    })
    const result = await runResearchAgent(d, 'q', options)

    expect(callTool).not.toHaveBeenCalled()
    expect(result.steps.some(step => step.kind === 'mcp_tool' && step.summary.includes('未获授权'))).toBe(true)
  })

  it('calls an approved MCP tool with a timeout guard', async () => {
    const callTool = vi.fn(async (_id: string, _name: string, _args: Record<string, unknown>, _ok: boolean) => ({ hits: 3 }))
    const d = deps({
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() { return [{ name: 'search_web' }] },
      callMcpTool: callTool,
    })
    const result = await runResearchAgent(d, 'q', { ...options, approveToolCalls: true })

    expect(callTool).toHaveBeenCalledTimes(1)
    expect(callTool.mock.calls[0]?.[1]).toBe('search_web')
    expect(result.steps.some(step => step.kind === 'mcp_tool' && step.summary.includes('search_web'))).toBe(true)
  })

  it('isolates a failing MCP server instead of aborting the run', async () => {
    const d = deps({
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() { throw new Error('server unreachable') },
    })
    const result = await runResearchAgent(d, 'q', { ...options, approveToolCalls: true })

    expect(result.answer).toBe('final answer')
    expect(result.steps.some(step => step.summary === 'MCP 不可用，已跳过')).toBe(true)
  })

  it('never exceeds the configured step budget', async () => {
    const d = deps({
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() { return [{ name: 'search_web' }] },
      async callMcpTool() { return {} },
    })
    const result = await runResearchAgent(d, 'q', { ...options, approveToolCalls: true, maxSteps: 2 })

    expect(result.steps.length).toBeLessThanOrEqual(3)
    expect(result.stopped?.reason).toBe('max_steps')
  })

  it('leaves no run behind when recording itself fails', async () => {
    const d = deps({ async recordAgentRun() { throw new Error('db locked') } })
    const result = await runResearchAgent(d, 'q', options)
    expect(result.run).toBeNull()
    expect(result.stopped?.message).toContain('db locked')
  })
})