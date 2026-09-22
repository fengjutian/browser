export const SITE_PERMISSIONS_KEY = 'browser.sitePermissions'
export type SitePermissionKind = 'camera'|'microphone'|'location'|'notifications'|'clipboard'
export interface SitePermissionRule {
  origin: string
  camera: boolean
  microphone: boolean
  location: boolean
  notifications: boolean
  clipboard: boolean
}

export function readSitePermissions(): SitePermissionRule[] {
  try {
    const value = JSON.parse(localStorage.getItem(SITE_PERMISSIONS_KEY) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter((item): item is SitePermissionRule => !!item && typeof item === 'object' && typeof (item as SitePermissionRule).origin === 'string') : []
  } catch { return [] }
}

export function writeSitePermissions(rules: SitePermissionRule[]) {
  localStorage.setItem(SITE_PERMISSIONS_KEY, JSON.stringify(rules))
}

export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`)
    return url.origin
  } catch { return null }
}
