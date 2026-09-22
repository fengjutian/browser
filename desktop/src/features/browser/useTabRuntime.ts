import { useEffect, useRef } from 'react'
import type { BrowserTab } from '../../types'
import {
  isNativeTabAlive,
  readNativeState,
  restoreNativeScroll,
  type NativeBrowserState,
} from '../../services/nativeBrowser'
import { decideTabSync, TAB_SYNC_FAILURE_THRESHOLD } from './tabSyncReducer'

export interface TabRuntimeInputs {
  tab: BrowserTab
  /** Resize observer bounds for when we need to reopen the underlying webview. */
  getBounds: () => { x: number; y: number; width: number; height: number } | undefined
  /** Called when polling succeeds. */
  onApply: (patch: Partial<BrowserTab>, restoreScroll?: { x: number; y: number }) => void
  /** Called when the polling loop decides the webview should be reopened. */
  onReopen: (reason: 'crash-or-stuck') => void
  /** Polling interval in ms. Background tabs may pass a larger value. */
  intervalMs?: number
  /** Whether the active panel is visible — polling pauses when hidden. */
  visible: boolean
}

/**
 * Polls `browser_state` for the active tab, applies patches, restores scroll
 * once the page finishes loading, and reopens the underlying webview after
 * `TAB_SYNC_FAILURE_THRESHOLD` consecutive failures (when the webview is also
 * reported as dead). Pure decision logic lives in `./tabSyncReducer` so the
 * recovery threshold is unit-testable.
 */
export function useTabRuntime(inputs: TabRuntimeInputs): void {
  const { tab, onApply, onReopen, intervalMs = 750, visible } = inputs
  const failureCountRef = useRef(new Map<string, number>())
  const pendingScrollRef = useRef(new Map<string, { x: number; y: number }>())
  const inputsRef = useRef(inputs)
  inputsRef.current = inputs

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
          onReopen('crash-or-stuck')
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
      onApply(decision.patch, decision.restoreScroll)
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
  }, [tab.id, tab.url, intervalMs, visible, onApply, onReopen])

  /**
   * Imperative API used by callers (BrowserPage, useTabSession) to enqueue a
   * scroll restore for a tab they're about to open — kept on the hook instance
   * via a stable ref so callers don't have to track refs themselves.
   */
  useTabRuntime.enqueueScroll = (tabId: string, position: { x: number; y: number }) => {
    pendingScrollRef.current.set(tabId, position)
  }

  useTabRuntime.getFailureCount = (tabId: string) => failureCountRef.current.get(tabId) ?? 0

  // Force the threshold symbol to remain referenced from this module even
  // when consumers only destructure the hook — useful for tree-shaking guards.
  void TAB_SYNC_FAILURE_THRESHOLD
}

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace useTabRuntime {
  function enqueueScroll(tabId: string, position: { x: number; y: number }): void
  function getFailureCount(tabId: string): number
}

function safeHostname(url: string): string {
  try { return new URL(url).hostname } catch { return '新标签页' }
}