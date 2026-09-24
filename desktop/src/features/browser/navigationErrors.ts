/**
 * Navigation error classification and file-name sanitization.
 * Extracted from BrowserPage so the logic can be unit-tested without React.
 */
import type { BrowserTabError } from '../../types'
import { diagnoseNativeNavigation } from '../../services/nativeBrowser'

export function classifyNavigationError(error: unknown): BrowserTabError {
  const message = String(error)
  const protocolMatch = /^(external|blocked|unknown)-protocol:([a-z]+)/i.exec(message)
  if (protocolMatch) {
    const scheme = protocolMatch[2]
    return { kind: 'unsupported-protocol', message: `不支持的协议：${scheme}://（应用仅打开 http/https 链接）` }
  }
  return { kind: 'load-failed', message }
}

export function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || '网页'
}

export async function diagnoseNavigationError(url: string, error: unknown): Promise<BrowserTabError> {
  const basic = classifyNavigationError(error)
  if (basic.kind === 'unsupported-protocol') return basic
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind:'offline', message:'设备当前处于离线状态，请检查网络连接。' }
  try {
    const result = await diagnoseNativeNavigation(url)
    if (result.kind === 'reachable') return basic
    return { kind: result.kind, message: result.message, httpStatus: result.httpStatus } as BrowserTabError
  } catch { return basic }
}
