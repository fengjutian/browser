/**
 * Per-origin site permission rules. Values are persisted in localStorage so
 * the WebView's permission_guard_script can pick them up before any page
 * script runs. The legacy `boolean` shape is still accepted on read so we
 * don't have to invalidate existing browser data.
 *
 * Rule semantics:
 *  - `allow`: the JS API is exposed as the browser intended.
 *  - `deny`:  the JS API rejects with a NotAllowedError.
 *  - `ask`:   the WebView prompt is suppressed; instead the host (BrowserPage)
 *             shows an inline bar and dispatches the decision back to the
 *             guard script, which resolves the original JS call.
 *
 * The default for every (origin, kind) pair is `ask`; the host never grants
 * silently. `deny` is the policy when the host is hidden or in private mode.
 */

import { replaceSitePermissions } from '../../api'

export const SITE_PERMISSIONS_KEY = 'browser.sitePermissions.v2'

export type SitePermissionKind =
  | 'camera'
  | 'microphone'
  | 'location'
  | 'notifications'
  | 'clipboard'

export const SITE_PERMISSION_KINDS: SitePermissionKind[] = [
  'camera',
  'microphone',
  'location',
  'notifications',
  'clipboard',
]

export type SitePermissionValue = 'allow' | 'deny' | 'ask'

export interface SitePermissionRule {
  origin: string
  camera: SitePermissionValue
  microphone: SitePermissionValue
  location: SitePermissionValue
  notifications: SitePermissionValue
  clipboard: SitePermissionValue
}

export interface LegacySitePermissionRule {
  origin: string
  camera?: boolean
  microphone?: boolean
  location?: boolean
  notifications?: boolean
  clipboard?: boolean
}

const DEFAULT_RULE: Omit<SitePermissionRule, 'origin'> = {
  camera: 'ask',
  microphone: 'ask',
  location: 'ask',
  notifications: 'ask',
  clipboard: 'ask',
}

function isValue(value: unknown): value is SitePermissionValue {
  return value === 'allow' || value === 'deny' || value === 'ask'
}

function coerceLegacy(rule: LegacySitePermissionRule): SitePermissionRule {
  const coerce = (value: unknown): SitePermissionValue => {
    if (isValue(value)) return value
    if (value === true) return 'allow'
    if (value === false) return 'deny'
    return 'ask'
  }
  return {
    origin: rule.origin,
    camera: coerce(rule.camera),
    microphone: coerce(rule.microphone),
    location: coerce(rule.location),
    notifications: coerce(rule.notifications),
    clipboard: coerce(rule.clipboard),
  }
}

function isRule(value: unknown): value is LegacySitePermissionRule {
  return !!value && typeof value === 'object' && typeof (value as LegacySitePermissionRule).origin === 'string'
}

function readRaw(): unknown {
  try {
    return JSON.parse(localStorage.getItem(SITE_PERMISSIONS_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function readSitePermissions(): SitePermissionRule[] {
  const raw = readRaw()
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isRule)
    .map(coerceLegacy)
}

export function writeSitePermissions(rules: SitePermissionRule[]) {
  localStorage.setItem(SITE_PERMISSIONS_KEY, JSON.stringify(rules))
  void replaceSitePermissions(rules).catch(() => undefined)
}

export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`)
    return url.origin
  } catch {
    return null
  }
}

export function defaultRuleFor(origin: string): SitePermissionRule {
  return { origin, ...DEFAULT_RULE }
}

export function getRule(origin: string, rules: SitePermissionRule[] = readSitePermissions()): SitePermissionRule | null {
  return rules.find(rule => rule.origin === origin) ?? null
}

export function getEffective(origin: string, kind: SitePermissionKind, rules?: SitePermissionRule[]): SitePermissionValue {
  const rule = getRule(origin, rules)
  if (!rule) return 'ask'
  return rule[kind]
}

export function setKind(origin: string, kind: SitePermissionKind, value: SitePermissionValue): SitePermissionRule[] {
  const all = readSitePermissions()
  const index = all.findIndex(rule => rule.origin === origin)
  if (index < 0) {
    return [...all, { ...defaultRuleFor(origin), [kind]: value }]
  }
  const updated = all.slice()
  updated[index] = { ...all[index], [kind]: value }
  return updated
}

export function upsertRule(rule: SitePermissionRule): SitePermissionRule[] {
  const all = readSitePermissions()
  const index = all.findIndex(existing => existing.origin === rule.origin)
  const next = all.slice()
  if (index < 0) {
    next.push(rule)
  } else {
    next[index] = { ...all[index], ...rule }
  }
  return next
}

export function removeRule(origin: string): SitePermissionRule[] {
  return readSitePermissions().filter(rule => rule.origin !== origin)
}

export function clearAllRules(): void {
  localStorage.removeItem(SITE_PERMISSIONS_KEY)
}
