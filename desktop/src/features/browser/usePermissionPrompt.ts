import { useCallback, useEffect, useRef, useState } from 'react'
import { onPermissionRequest, type PermissionRequest } from '../../services/nativeBrowser'
import { respondPermissionRequest } from '../../services/permissions'
import { getRule, setKind, type SitePermissionKind, type SitePermissionRule, type SitePermissionValue, writeSitePermissions, readSitePermissions } from './sitePermissions'

export type PermissionDecision = 'allow-once' | 'allow-always' | 'deny-once' | 'deny-always'

export interface PermissionPromptProps {
  /** When false, the host silently denies every pending request. */
  enabled?: boolean
  /** Fired after the user makes a decision (for telemetry). */
  onDecided?: (request: PermissionRequest, decision: PermissionDecision) => void
}

export interface UsePermissionPromptResult {
  pending: PermissionRequest | null
  /** Resolve the current prompt and persist rules if scope is "always". */
  decide: (decision: PermissionDecision) => Promise<void>
}

/**
 * Drives the address-bar permission prompt. Listens to
 * `browser://permission-request` from any child WebView, shows the most
 * recent request in the inline bar, and replies via the Rust
 * `browser_permission_respond` command. Older requests in the queue are
 * dropped (the WebView has a 15 s timeout so a stale response is harmless).
 */
export function usePermissionPrompt(options: PermissionPromptProps = {}): UsePermissionPromptResult {
  const { enabled = true, onDecided } = options
  const [pending, setPending] = useState<PermissionRequest | null>(null)
  const queueRef = useRef<PermissionRequest[]>([])
  const onDecidedRef = useRef(onDecided)
  onDecidedRef.current = onDecided

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void onPermissionRequest(request => {
      if (disposed) return
      queueRef.current.push(request)
      setPending(current => current ?? request)
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [enabled])

  const decide = useCallback(async (decision: PermissionDecision) => {
    if (!pending) return
    const request = pending
    setPending(queueRef.current.shift() ?? null)

    let allow = false
    let persistValue: SitePermissionValue | null = null
    if (decision === 'allow-once') {
      allow = true
    } else if (decision === 'allow-always') {
      allow = true
      persistValue = 'allow'
    } else if (decision === 'deny-once') {
      allow = false
    } else if (decision === 'deny-always') {
      allow = false
      persistValue = 'deny'
    }
    if (persistValue && isSitePermissionKind(request.kind)) {
      const next = setKind(request.origin, request.kind, persistValue)
      writeSitePermissions(next)
    }
    try {
      await respondPermissionRequest(request.requestId, allow)
    } catch {
      // Network-level failure is non-fatal; the WebView's 15 s timeout will
      // deny the call and the user can retry by triggering the API again.
    }
    onDecidedRef.current?.(request, decision)
  }, [pending])

  return { pending, decide }
}

/**
 * The host can pre-empt the prompt when the user has already chosen
 * "always allow" or "always deny" in a previous session. This helper is
 * invoked from the inline bar so the UI can stay in sync with the rules
 * that `setKind` just persisted.
 */
export function describeRule(origin: string, kind: SitePermissionKind): SitePermissionValue {
  const rule: SitePermissionRule | null = getRule(origin)
  return rule ? rule[kind] : 'ask'
}

/**
 * Compose origin + kind into a human label for the inline prompt.
 */
export function describePrompt(request: PermissionRequest): { origin: string; kind: string; kindLabel: string; originLabel: string } {
  const kindLabel = PERMISSION_LABELS[request.kind] ?? request.kind
  return {
    origin: request.origin,
    kind: request.kind,
    kindLabel,
    originLabel: originDisplay(request.origin),
  }
}

const PERMISSION_LABELS: Record<PermissionRequest['kind'], string> = {
  camera: '摄像头',
  microphone: '麦克风',
  location: '定位',
  notifications: '通知',
  clipboard: '剪贴板读取',
  media: '摄像头 + 麦克风',
}

function originDisplay(origin: string): string {
  try {
    const url = new URL(origin)
    return url.hostname || origin
  } catch {
    return origin
  }
}

function isSitePermissionKind(kind: string): kind is SitePermissionKind {
  return kind === 'camera' || kind === 'microphone' || kind === 'location' || kind === 'notifications' || kind === 'clipboard'
}

/**
 * Force-deny helper for "private mode" / "host hidden" cases. Sets every
 * rule for the given origin to `deny` and silently responds to any
 * in-flight request. The host should call this on mount when in private
 * mode and reverse it when leaving private mode.
 */
export function forceAllDenyFor(origin: string): void {
  const all = readSitePermissions()
  const rule = all.find(item => item.origin === origin)
  if (!rule) return
  writeSitePermissions(all.map(item => item.origin === origin ? {
    ...item,
    camera: 'deny',
    microphone: 'deny',
    location: 'deny',
    notifications: 'deny',
    clipboard: 'deny',
  } : item))
}

export function resetOrigin(origin: string): void {
  writeSitePermissions(readSitePermissions().filter(rule => rule.origin !== origin))
}