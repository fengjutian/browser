import { useEffect } from 'react'
import { claimPendingTask, completeTask, failTask, listAIProviders, recoverStaleTasks } from '../../api'
import { createTaskHandlers } from './taskHandlers'
import { createTaskWorker, DEFAULT_STALE_AFTER_MS } from './taskWorker'

const queueApi = { claimPendingTask, completeTask, failTask, recoverStaleTasks }

/**
 * Start the background task worker for the life of the app.
 *
 * On mount it recovers tasks abandoned by a crashed session and drains the
 * queue. Without an AI provider there is nothing the handlers can do, so the
 * worker stays idle rather than burning retries on unhandled task kinds.
 */
export function useTaskWorker(): void {
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const providers = await listAIProviders()
      if (cancelled || providers.length === 0) return
      const worker = createTaskWorker(queueApi, createTaskHandlers(providers[0]), {
        staleAfterMs: DEFAULT_STALE_AFTER_MS,
      })
      await worker.recoverAndDrain(25)
    })().catch(() => undefined)
    return () => { cancelled = true }
  }, [])
}