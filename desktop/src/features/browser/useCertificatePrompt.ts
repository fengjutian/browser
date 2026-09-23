import { useEffect, useState } from 'react'
import {
  onCertificateError,
  onCertificateErrorCleared,
  respondCertificateRequest,
  type CertificateErrorPayload,
} from '../../services/nativeBrowser'

export interface CertificatePromptHandle {
  /** The most recent certificate failure the host surfaced. `null` when none. */
  prompt: CertificateErrorPayload | null
  /** Acknowledge the error: false = keep the page blocked, true = pretend allow (no-op today). */
  respond: (allow: boolean) => Promise<void>
}

/**
 * Subscribes to `browser://certificate-error` and the matching cleared event so
 * the UI can render a persistent banner while the underlying webview refuses
 * to load the page. The host is the source of truth — we only display.
 */
export function useCertificatePrompt(): CertificatePromptHandle {
  const [prompt, setPrompt] = useState<CertificateErrorPayload | null>(null)

  useEffect(() => {
    let disposed = false
    const unsubs: Array<() => void> = []
    void onCertificateError(payload => {
      if (disposed) return
      setPrompt(payload)
    }).then(stop => { if (!disposed) unsubs.push(stop); else stop() })
    void onCertificateErrorCleared(requestId => {
      if (disposed) return
      setPrompt(current => (current && current.requestId === requestId ? null : current))
    }).then(stop => { if (!disposed) unsubs.push(stop); else stop() })
    return () => { disposed = true; unsubs.forEach(stop => stop()) }
  }, [])

  return {
    prompt,
    respond: async (allow: boolean) => {
      if (!prompt) return
      const id = prompt.requestId
      // Optimistic clear — the host's cleared event will confirm.
      setPrompt(null)
      try { await respondCertificateRequest(id, allow) } catch { /* host may be unavailable */ }
    },
  }
}