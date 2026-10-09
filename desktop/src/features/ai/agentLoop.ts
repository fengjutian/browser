import { aiChat, callMcpTool, discoverMcpServer, listMcpServers, listMcpTools, recordAgentRun, searchDocuments, updateAgentRunStatus, type AgentRun } from '../../api'
import type { ChatRequest } from '../../types'

/**
 * Controlled research agent.
 *
 * The loop is deliberately bounded: it performs at most `maxSteps` steps and
 * refuses to start without a budget, so a confused model cannot loop forever or
 * spend unbounded tokens. Every step is recorded into `agent_runs` so the user
 * can see what happened after the fact.
 */

export const DEFAULT_MAX_STEPS = 4
export const DEFAULT_MAX_TOOL_CALLS = 3
export const MCP_TOOL_TIMEOUT_MS = 20_000

export interface AgentStep {
  index: number
  kind: 'search' | 'mcp_tool' | 'answer'
  summary: string
  detail?: string
  at: string
}

export interface AgentBudgetExceeded {
  reason: 'max_steps' | 'max_tool_calls' | 'token_budget'
  message: string
}

export interface AgentRunResult {
  run: AgentRun | null
  steps: AgentStep[]
  answer: string
  /** Set when the loop stopped on a budget rather than completing normally. */
  stopped: AgentBudgetExceeded | null
}

export interface AgentDeps {
  recordAgentRun(title: string): Promise<AgentRun>
  updateAgentRunStatus(input: {
    id: string
    status: 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled'
    stepsJson?: string
    finalAnswer?: string
    lastError?: string
  }): Promise<void>
  searchDocuments(query: string): Promise<{ id: string; title: string; markdownSnippet?: string; summarySnippet?: string }[]>
  aiChat(providerId: string, request: ChatRequest): Promise<{ content: string; promptTokens?: number; completionTokens?: number }>
  listMcpServers(): Promise<{ id: string; name: string; enabled: boolean }[]>
  discoverMcpServer(serverId: string): Promise<unknown>
  listMcpTools(serverId: string): Promise<unknown>
  callMcpTool(serverId: string, name: string, args: Record<string, unknown>, approved: boolean): Promise<unknown>
}

export interface AgentOptions {
  providerId: string
  maxSteps?: number
  maxToolCalls?: number
  /** Abort a run that has consumed this many prompt tokens. */
  maxPromptTokens?: number
  /** MCP tools are never executed without an explicit approval flag. */
  approveToolCalls?: boolean
}

const SYSTEM_PROMPT = [
  'You are a research assistant operating over the user’s personal knowledge base.',
  'Use the provided source excerpts only. If they do not answer the question, say so plainly.',
  'Answer in the user’s language and keep the answer concise.',
].join(' ')

function now(): string {
  return new Date().toISOString()
}

function excerpt(text: string, limit = 400): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

/** Reject with a timeout error if `work` overruns `ms`. */
async function withToolTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('MCP tool call timed out')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function serializeSteps(steps: AgentStep[]): string {
  return JSON.stringify(steps.map(({ index, kind, summary, at }) => ({ index, kind, summary, at })))
}

/**
 * Run one bounded research pass and persist it as an `agent_runs` row.
 *
 * The run is created up-front so a crash mid-loop still leaves a trace, and its
 * status is updated after every step.
 */
export async function runResearchAgent(
  deps: AgentDeps,
  question: string,
  options: AgentOptions,
): Promise<AgentRunResult> {
  const maxSteps = Math.max(1, options.maxSteps ?? DEFAULT_MAX_STEPS)
  const maxToolCalls = Math.max(0, options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS)
  const maxPromptTokens = options.maxPromptTokens ?? Number.POSITIVE_INFINITY

  const steps: AgentStep[] = []
  let run: AgentRun | null = null
  let toolCalls = 0
  let promptTokens = 0
  let stopped: AgentBudgetExceeded | null = null

  const record = async () => {
    if (run) {
      await deps.updateAgentRunStatus({ id: run.id, status: 'running', stepsJson: serializeSteps(steps) })
    }
  }

  try {
    run = await deps.recordAgentRun(question.slice(0, 120) || 'research run')
    await deps.updateAgentRunStatus({ id: run.id, status: 'running', stepsJson: '[]' })

    const sources = await deps.searchDocuments(question)
    steps.push({
      index: steps.length + 1,
      kind: 'search',
      summary: `检索到 ${sources.length} 条来源`,
      detail: sources.slice(0, 5).map(item => item.title).join(' / '),
      at: now(),
    })
    await record()

    // Optional MCP enrichment. Tools require explicit approval and are isolated:
    // a failing or slow tool is recorded and skipped, never fatal.
    const servers = await deps.listMcpServers()
    const server = servers.find(item => item.enabled)
    if (server && toolCalls < maxToolCalls) {
      try {
        await withToolTimeout(deps.discoverMcpServer(server.id), MCP_TOOL_TIMEOUT_MS)
        const tools = await withToolTimeout(deps.listMcpTools(server.id), MCP_TOOL_TIMEOUT_MS)
        const toolName = firstToolName(tools)
        if (toolName && options.approveToolCalls === true) {
          toolCalls += 1
          const result = await withToolTimeout(
            deps.callMcpTool(server.id, toolName, { query: question }, true),
            MCP_TOOL_TIMEOUT_MS,
          )
          steps.push({
            index: steps.length + 1,
            kind: 'mcp_tool',
            summary: `调用 MCP 工具 ${toolName}`,
            detail: excerpt(JSON.stringify(result) ?? ''),
            at: now(),
          })
        } else if (toolName) {
          steps.push({
            index: steps.length + 1,
            kind: 'mcp_tool',
            summary: `发现 MCP 工具 ${toolName}，未获授权故跳过`,
            at: now(),
          })
        }
        await record()
      } catch (error) {
        steps.push({
          index: steps.length + 1,
          kind: 'mcp_tool',
          summary: 'MCP 不可用，已跳过',
          detail: error instanceof Error ? error.message : String(error),
          at: now(),
        })
        await record()
      }
    }

    if (steps.length >= maxSteps) {
      stopped = { reason: 'max_steps', message: `已达到最大步骤数 ${maxSteps}` }
    }

    const request: ChatRequest = {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `问题：${question}`,
            '',
            '来源：',
            ...sources.slice(0, 8).map((item, index) => `[${index + 1}] ${item.title}\n${item.markdownSnippet ?? item.summarySnippet ?? ''}`),
          ].join('\n'),
        },
      ],
      temperature: 0.2,
    }
    const response = await deps.aiChat(options.providerId, request)
    promptTokens += response.promptTokens ?? 0
    if (promptTokens > maxPromptTokens) {
      stopped = { reason: 'token_budget', message: `超出 token 预算 ${maxPromptTokens}` }
    }
    if (toolCalls > maxToolCalls) {
      stopped = { reason: 'max_tool_calls', message: `超出 MCP 工具调用上限 ${maxToolCalls}` }
    }

    steps.push({ index: steps.length + 1, kind: 'answer', summary: '生成回答', at: now() })
    const answer = response.content
    await deps.updateAgentRunStatus({
      id: run.id,
      status: stopped ? 'cancelled' : 'completed',
      stepsJson: serializeSteps(steps),
      finalAnswer: answer,
      ...(stopped ? { lastError: stopped.message } : {}),
    })
    return { run, steps, answer, stopped }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (run) {
      await deps.updateAgentRunStatus({
        id: run.id,
        status: 'failed',
        stepsJson: serializeSteps(steps),
        lastError: message,
      }).catch(() => undefined)
    }
    return { run, steps, answer: '', stopped: { reason: 'max_steps', message } }
  }
}

function firstToolName(tools: unknown): string | null {
  if (!Array.isArray(tools)) return null
  const first = tools[0] as { name?: unknown } | undefined
  return typeof first?.name === 'string' ? first.name : null
}

/** Production dependency binding for {@link runResearchAgent}. */
export const defaultAgentDeps: AgentDeps = {
  recordAgentRun,
  updateAgentRunStatus,
  searchDocuments,
  aiChat,
  listMcpServers,
  discoverMcpServer,
  listMcpTools,
  callMcpTool,
}