import { describe, expect, it, vi } from 'vitest'
import type { Task } from '../../types'
import {
  BASE_BACKOFF_SECONDS,
  MAX_BACKOFF_SECONDS,
  backoffSeconds,
  createTaskWorker,
  withTimeout,
  type TaskQueueApi,
} from './taskWorker'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    kind: 'unit.test',
    documentId: 'doc-1',
    payload: '{}',
    status: 'PENDING',
    // Matches the real queue: enqueue stores 0 attempts, each claim adds one.
    attempts: 0,
    maxAttempts: 3,
    availableAt: '2026-10-07T00:00:00Z',
    ...overrides,
  }
}

/**
 * In-memory stand-in for the `tasks` table with the same lifecycle rules:
 * claims increment `attempts`, a failure schedules the retry via `available_at`
 * (so a backed-off task is not claimed again in the same drain), and the retry
 * budget is spent down to a terminal FAILED state.
 */
function fakeQueue(initial: Task[] = []) {
  const queue = [...initial]
  const completed: string[] = []
  const failed: { id: string; error: string; backoff: number }[] = []
  const recovered: string[] = []
  /** Simulated clock for `available_at`, so backoff is observable. */
  let now = Date.parse('2026-10-07T00:00:00Z')
  const availableAt = (task: Task): number => Date.parse(task.availableAt)

  const api: TaskQueueApi = {
    async claimPendingTask() {
      const index = queue.findIndex(
        item => item.status === 'PENDING' && availableAt(item) <= now,
      )
      if (index < 0) return null
      const claimed = { ...queue[index], status: 'PROCESSING' as const, attempts: queue[index].attempts + 1 }
      queue[index] = claimed
      return claimed
    },
    async completeTask(id) {
      completed.push(id)
      const item = queue.find(entry => entry.id === id)
      if (item) item.status = 'COMPLETED'
    },
    async failTask(id, error, backoff) {
      failed.push({ id, error, backoff })
      const item = queue.find(entry => entry.id === id)
      if (item) {
        item.lastError = error
        item.status = item.attempts >= item.maxAttempts ? 'FAILED' : 'PENDING'
        item.availableAt = new Date(now + backoff * 1000).toISOString()
      }
    },
    async recoverStaleTasks(_timeoutSeconds) {
      const stale = queue.filter(item => item.status === 'PROCESSING')
      stale.forEach(item => {
        item.status = 'PENDING'
        // A recovered task is immediately claimable again.
        item.availableAt = new Date(now).toISOString()
      })
      recovered.push(...stale.map(item => item.id))
      return stale.length
    },
  }
  return { api, queue, completed, failed, recovered, advance: (ms: number) => { now += ms } }
}

describe('backoffSeconds', () => {
  it('grows exponentially and stays capped', () => {
    expect(backoffSeconds(1)).toBe(BASE_BACKOFF_SECONDS)
    expect(backoffSeconds(2)).toBe(BASE_BACKOFF_SECONDS * 2)
    expect(backoffSeconds(3)).toBe(BASE_BACKOFF_SECONDS * 4)
    expect(backoffSeconds(50)).toBe(MAX_BACKOFF_SECONDS)
    expect(backoffSeconds(0)).toBe(BASE_BACKOFF_SECONDS)
  })
})

describe('withTimeout', () => {
  it('resolves when the work finishes in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'work')).resolves.toBe('ok')
  })

  it('rejects when the work overruns', async () => {
    const slow = new Promise<string>(resolve => setTimeout(() => resolve('late'), 50))
    await expect(withTimeout(slow, 5, 'slow work')).rejects.toThrow(/timed out/)
  })
})

describe('createTaskWorker', () => {
  it('claims and completes a successful task', async () => {
    const { api, completed, failed } = fakeQueue([task()])
    const handler = vi.fn(async () => undefined)
    const worker = createTaskWorker(api, { 'unit.test': handler })

    const processed = await worker.drain(5)

    expect(processed).toBe(1)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(completed).toEqual(['task-1'])
    expect(failed).toHaveLength(0)
  })

  it('fails a throwing task with backoff and keeps draining', async () => {
    const { api, completed, failed } = fakeQueue([task(), task({ id: 'task-2' })])
    const worker = createTaskWorker(api, {
      'unit.test': async item => {
        if (item.id === 'task-1') throw new Error('embedding provider refused')
      },
    })

    await worker.drain(5)

    expect(failed).toHaveLength(1)
    expect(failed[0].id).toBe('task-1')
    expect(failed[0].error).toContain('embedding provider refused')
    expect(failed[0].backoff).toBe(BASE_BACKOFF_SECONDS)
    expect(completed).toEqual(['task-2'])
  })

  it('backs off progressively across repeated attempts', async () => {
    const { api, failed, advance } = fakeQueue([task()])
    const worker = createTaskWorker(api, { 'unit.test': async () => { throw new Error('boom') } })

    // First claim -> attempts 1 -> base backoff.
    await worker.runOnce()
    // A backed-off task is not claimable until its retry time passes.
    expect(await worker.runOnce()).toBeNull()
    advance(BASE_BACKOFF_SECONDS * 1000)
    await worker.runOnce()

    expect(failed.map(entry => entry.backoff)).toEqual([
      BASE_BACKOFF_SECONDS,
      BASE_BACKOFF_SECONDS * 2,
    ])
  })

  it('marks a task failed once its attempts are exhausted', async () => {
    const { api, queue } = fakeQueue([task({ attempts: 2, maxAttempts: 3 })])
    const worker = createTaskWorker(api, { 'unit.test': async () => { throw new Error('permanent') } })

    await worker.runOnce()

    expect(queue[0].status).toBe('FAILED')
  })

  it('never calls a handler for an unregistered task kind', async () => {
    const { api, failed, completed } = fakeQueue([task({ kind: 'unknown.kind' })])
    const worker = createTaskWorker(api, {})

    await worker.runOnce()

    // The kind is recorded as unsupported with a zero backoff, so the retry
    // budget is spent quickly instead of blocking the queue for minutes.
    expect(failed).toHaveLength(1)
    expect(failed[0].error).toContain('no handler registered')
    expect(failed[0].backoff).toBe(0)
    expect(completed).toHaveLength(0)
  })

  it('times a hanging task out instead of blocking the queue', async () => {
    const { api, failed } = fakeQueue([task()])
    const worker = createTaskWorker(
      api,
      { 'unit.test': () => new Promise<void>(() => undefined) },
      { taskTimeoutMs: 10 },
    )

    await worker.runOnce()

    expect(failed).toHaveLength(1)
    expect(failed[0].error).toMatch(/timed out/)
  })

  it('recovers crashed tasks before draining and does not reprocess completed work', async () => {
    const crashed = task({ id: 'task-crashed', status: 'PROCESSING' })
    const done = task({ id: 'task-done', status: 'COMPLETED' })
    const { api, queue, completed, recovered } = fakeQueue([crashed, done])
    const handler = vi.fn(async (_task: Task) => undefined)
    const worker = createTaskWorker(api, { 'unit.test': handler })

    await worker.recoverAndDrain(5)

    expect(recovered).toEqual(['task-crashed'])
    expect(queue.find(item => item.id === 'task-crashed')?.status).toBe('COMPLETED')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]?.[0]?.id).toBe('task-crashed')
    expect(completed).toEqual(['task-crashed'])
  })

  it('stops draining when the queue is empty', async () => {
    const { api } = fakeQueue([])
    const worker = createTaskWorker(api, { 'unit.test': async () => undefined })
    expect(await worker.drain(5)).toBe(0)
  })

  it('reports handler failures through onError', async () => {
    const { api } = fakeQueue([task()])
    const onError = vi.fn()
    const worker = createTaskWorker(api, {
      'unit.test': async () => { throw new Error('nope') },
    }, { onError })

    await worker.runOnce()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][1]).toContain('nope')
  })
})