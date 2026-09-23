/**
 * Session-scoped helpers for "private tabs" (incognito windows). These
 * helpers are intentionally NOT persisted to localStorage — private tabs
 * live only in memory and leave no trace when the app closes.
 *
 * A tab is "private" when `BrowserTab.private === true`. Privacy rules:
 *  - History is not written (`history dedupe` skips private tabs).
 *  - Session list is not written (`browser.tabs` persistence filters them).
 *  - Downloads are not persisted (`useDownloadCenter` drops the v2 event).
 *  - Closed-tab stack is not appended (we'd rather lose the entry).
 *  - Site permissions for the tab's origin are force-denied at creation.
 */
import type { BrowserTab } from '../../types'
import { forceAllDenyFor, resetOrigin } from './usePermissionPrompt'

export const PRIVATE_TAB_BADGE = '私密'

export function isPrivateTab(tab: Pick<BrowserTab, 'private'> | undefined | null): boolean {
  return !!tab?.private
}

export function makePrivateTab(id: string = crypto.randomUUID(), url: string = ''): BrowserTab {
  return {
    id,
    url,
    title: url ? '正在加载…' : '新私密窗口',
    loading: false,
    active: true,
    pinned: false,
    private: true,
  }
}

/**
 * Drop every tab that has `private: true` from a session payload before it
 * hits localStorage. Pinned / private are kept in memory for the session.
 */
export function stripPrivateTabs(tabs: BrowserTab[]): BrowserTab[] {
  return tabs.filter(tab => !tab.private)
}

/**
 * After the last private tab closes we wipe the permission rules the
 * session accumulated so a fresh "open private tab" cannot piggy-back on
 * decisions the user already rejected. This is intentionally aggressive —
 * private tabs exist to leave no trace.
 */
export function resetPrivateSessionPermissions(activeOrigins: string[]): void {
  for (const origin of activeOrigins) resetOrigin(origin)
  // Force-deny ensures any leftover rules are also wiped.
  for (const origin of activeOrigins) forceAllDenyFor(origin)
}

/**
 * Heuristic for "should I treat this new URL as private?". The current
 * implementation has no auto-rule — private mode is opt-in via the tab
 * menu. We still expose this helper so callers can plug in heuristics
 * later (e.g. "always-private" domain list in Settings).
 */
export function shouldForcePrivate(_url: string): boolean {
  return false
}