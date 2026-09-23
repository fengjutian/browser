export const TRACKING_CLEANER_KEY = 'arcadia-plugin.tracking-cleaner.enabled'
export const TRACKING_CLEANER_EVENT = 'arcadia-plugin-tracking-cleaner-change'

const TRACKING_KEYS = new Set(['fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid'])

export function isTrackingCleanerEnabled(): boolean {
  try { return localStorage.getItem(TRACKING_CLEANER_KEY) === 'true' } catch { return false }
}

export function setTrackingCleanerEnabled(enabled: boolean): void {
  localStorage.setItem(TRACKING_CLEANER_KEY, enabled ? 'true' : 'false')
  window.dispatchEvent(new CustomEvent<boolean>(TRACKING_CLEANER_EVENT, { detail: enabled }))
}

export function cleanTrackingParameters(input: string): string {
  try {
    const url = new URL(input)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return input
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.toLowerCase().startsWith('utm_') || TRACKING_KEYS.has(key.toLowerCase())) url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    return input
  }
}
