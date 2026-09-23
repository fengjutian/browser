export const AD_BLOCKER_KEY = 'arcadia-plugin.ad-blocker.enabled'
export const AD_BLOCKER_EVENT = 'arcadia-plugin-ad-blocker-change'

export function isAdBlockerEnabled(): boolean {
  try { return localStorage.getItem(AD_BLOCKER_KEY) !== 'false' } catch { return true }
}

export function setAdBlockerEnabled(enabled: boolean): void {
  localStorage.setItem(AD_BLOCKER_KEY, enabled ? 'true' : 'false')
  window.dispatchEvent(new CustomEvent<boolean>(AD_BLOCKER_EVENT, { detail: enabled }))
}
