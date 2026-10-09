import type { Task } from '../../types'

/**
 * Exponential backoff for a failed task attempt, capped so a permanently
 * failing task does not get pushed hours into the future.
 */
export const BASE_BACKOFF_SECONDS = 30
export const MAX_BACKOFF_SECONDS = 30 * 60

export function backoffSeconds(attempt: number): number {
  const capped = Math.max(1, Math.min(attempt, 10))
  return Math.min(MAX_BACKOFF_SECONDS, BASE_BACKOFF_SECONDS * 2 ** (capped - 1))
}

export interface TaskQueueApi {
  claimPendingTask(): Promise<Task | null>
  completeTask(id: string): Promise<void>
  failTask(id: string, error: string, backoffSeconds: number): Promise<void>
  recoverStaleTasks(timeoutSeconds: number): Promise<number>
}

export interface TaskWorkerOptions {
  /** Wall-clock ceiling for a single task; exceeding it fails the task. */
  taskTimeoutMs?: number
  /** How long a PROCESSING task may sit before it counts as crash-leftover. */
  staleAfterMs?: number
  onError?: (task: Task, error: string) => void
}

export const DEFAULT_TASK_TIMEOUT_MS = 60_000
export const DEFAULT_STALE_AFTER_MS = 120_000

export type TaskHandler = (task: Task) => Promise<void>

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown task failure'
}

/**
 * Reject with a timeout error if `work` overruns `ms`.
 *
 * The underlying promise is intentionally not cancellable — task handlers talk to
 * a backend process we do not own — so this only stops the worker from waiting
 * forever and hands the failure to the retry machinery.
 */
export async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Process pending background tasks one at a time.
 *
 * A single task failure never stops the loop: the task is marked failed with a
 * backoff and the worker moves on. On startup `recoverStaleTasks` returns
 * PROCESSING rows abandoned by a crashed session to PENDING, so work is not
 * silently lost, and already-COMPLETED tasks are untouched by recovery.
 */
export function createTaskWorker(
  api: TaskQueueApi,
  handlers: Record<string, TaskHandler>,
  options: TaskWorkerOptions = {},
) {
  const timeoutMs = options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS

  async function runOnce(): Promise<Task | null> {
    const task = await api.claimPendingTask()
    if (!task) return null
    const handler = handlers[task.kind]
    if (!handler) {
      // An unknown kind must not spin: record it once and let the retry budget run out.
      await api.failTask(task.id, `no handler registered for task kind "${task.kind}"`, 0)
      return task
    }
    try {
      await withTimeout(handler(task), timeoutMs, `task ${task.kind}`)
      await api.completeTask(task.id)
    } catch (error) {
      const message = messageOf(error)
      options.onError?.(task, message)
      await api.failTask(task.id, message, backoffSeconds(task.attempts))
    }
    return task
  }

  /** Drain up to `limit` tasks. Stops early when the queue is empty. */
  async function drain(limit = 10): Promise<number> {
    let processed = 0
    while (processed < limit) {
      const task = await runOnce()
      if (!task) break
      processed += 1
    }
    return processed
  }

  /** Recover crash leftovers, then drain. Used on application start-up. */
  async function recoverAndDrain(limit = 10): Promise<number> {
    await api.recoverStaleTasks(Math.max(1, Math.round(staleAfterMs / 1000)))
    return drain(limit)
  }

  return { drain, recoverAndDrain, runOnce }
}

export type TaskWorker = ReturnType<typeof createTaskWorker>