import { useEffect, useRef } from 'react'
import type { BrowserTab } from '../../types'
import {
  isNativeTabAlive,
  readNativeState,
  restoreNativeScroll,
  type NativeBrowserState,
} from '../../services/nativeBrowser'
import { decideTabSync } from './tabSyncReducer'

export interface TabRuntimeInputs {
  tab: BrowserTab
  /** Called when polling succeeds. */
  onApply: (patch: Partial<BrowserTab>, restoreScroll?: { x: number; y: number }) => void
  /** Called when the polling loop decides the webview should be reopened. */
  onReopen: (reason: 'crash-or-stuck') => void
  /** Polling interval in ms. Background tabs may pass a larger value. */
  intervalMs?: number
  /** Whether the active panel is visible — polling pauses when hidden. */
  visible: boolean
}

export interface TabRuntimeHandle {
  /** Queue a scroll restore for the next poll where loading is false. */
  enqueueScroll: (tabId: string, position: { x: number; y: number }) => void
  /** Current consecutive failure count for a tab — exposed for diagnostics/tests. */
  getFailureCount: (tabId: string) => number
}

/**
 * Polls `browser_state` for the active tab, applies patches, restores scroll
 * once the page finishes loading, and reopens the underlying webview after
 * `TAB_SYNC_FAILURE_THRESHOLD` consecutive failures (when the webview is also
 * reported as dead). Pure decision logic lives in `./tabSyncReducer` so the
 * recovery threshold is unit-testable.
 */
export function useTabRuntime(inputs: TabRuntimeInputs): TabRuntimeHandle {
  const { tab, onApply, onReopen, intervalMs = 750, visible } = inputs
  const failureCountRef = useRef(new Map<string, number>())
  const pendingScrollRef = useRef(new Map<string, { x: number; y: number }>())
  const onApplyRef = useRef(onApply)
  const onReopenRef = useRef(onReopen)
  onApplyRef.current = onApply
  onReopenRef.current = onReopen

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let timer: number | undefined

    const sync = async () => {
      if (cancelled) return
      let state: NativeBrowserState | null = null
      let error: unknown
      try {
        state = await readNativeState(tab.id)
      } catch (caught) {
        error = caught
      }

      if (error) {
        const previousFailures = failureCountRef.current.get(tab.id) ?? 0
        const alive = await isNativeTabAlive(tab.id).catch(() => false)
        const decision = decideTabSync({
          state: null,
          isAlive: alive,
          previousFailures,
          fallbackTitle: safeHostname(tab.url),
        })
        if (decision.kind === 'reopen') {
          failureCountRef.current.delete(tab.id)
          onReopenRef.current('crash-or-stuck')
        } else if (decision.kind === 'bumpFailure') {
          failureCountRef.current.set(tab.id, decision.failures)
        }
        return
      }

      if (!state) return
      failureCountRef.current.delete(tab.id)
      const pending = pendingScrollRef.current.get(tab.id)
      const decision = decideTabSync({
        state,
        isAlive: true,
        previousFailures: 0,
        pendingScroll: pending,
        fallbackTitle: safeHostname(state.url),
      })
      if (decision.kind !== 'apply') return
      onApplyRef.current(decision.patch, decision.restoreScroll)
      if (pending && !state.loading && decision.restoreScroll) {
        pendingScrollRef.current.delete(tab.id)
        await restoreNativeScroll(tab.id, pending.x, pending.y).catch(() => undefined)
      }
    }

    void sync()
    timer = window.setInterval(() => void sync(), intervalMs)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [tab.id, tab.url, intervalMs, visible])

  return {
    enqueueScroll: (tabId, position) => { pendingScrollRef.current.set(tabId, position) },
    getFailureCount: tabId => failureCountRef.current.get(tabId) ?? 0,
  }
}

function safeHostname(url: string): string {
  try { return new URL(url).hostname } catch { return '新标签页' }
}