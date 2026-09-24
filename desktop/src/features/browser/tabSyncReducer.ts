import type { BrowserTab } from '../../types'
import type { NativeBrowserState } from '../../services/nativeBrowser'

/**
 * Pure decision tree for the polling state-sync loop the browser runs every
 * 750ms. The hook wrapper in useTabRuntime keeps the polling side effect and
 * just delegates the "what should I do with this poll response?" logic here so
 * it is unit-testable without fake timers.
 */
export type TabSyncDecision =
  | { kind: 'apply'; patch: Partial<BrowserTab>; restoreScroll?: { x: number; y: number } }
  | { kind: 'ignore' }
  | { kind: 'reopen'; failures: 0 }
  | { kind: 'bumpFailure'; failures: number }

export interface TabSyncInputs {
  state: NativeBrowserState | null
  isAlive: boolean
  previousFailures: number
  pendingScroll?: { x: number; y: number }
  fallbackTitle: string
}

const FAILURE_THRESHOLD = 3

export function decideTabSync(inputs: TabSyncInputs): TabSyncDecision {
  const { state, isAlive, previousFailures, pendingScroll, fallbackTitle } = inputs
  if (state) {
    const patch: Partial<BrowserTab> = {
      url: state.url,
      title: state.title || fallbackTitle,
      favicon: state.favicon,
      loading: state.loading,
      scrollX: Math.round(state.scrollX),
      scrollY: Math.round(state.scrollY),
      scrollDepth: state.scrollDepth ?? 0,
      canGoBack: state.canGoBack,
      canGoForward: state.canGoForward,
    }
    const restore = pendingScroll && !state.loading ? pendingScroll : undefined
    return { kind: 'apply', patch, restoreScroll: restore }
  }
  const nextFailures = previousFailures + 1
  if (nextFailures >= FAILURE_THRESHOLD && !isAlive) {
    return { kind: 'reopen', failures: 0 }
  }
  return { kind: 'bumpFailure', failures: nextFailures }
}

/**
 * Exposed so the hook and tests can agree on the recovery threshold. If this
 * number changes we want both to drift together.
 */
export const TAB_SYNC_FAILURE_THRESHOLD = FAILURE_THRESHOLD
