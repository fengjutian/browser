/**
 * Pure helpers that strip sensitive material before it is persisted to
 * `localStorage`, the session snapshot, or any future audit log. Designed to
 * be cheap and side-effect free so it can be called on every write.
 *
 * Strategy:
 *   - replace credential-bearing URLs with a [REDACTED] marker
 *   - scrub common auth headers / query params from any free-form log blob
 *   - never throw — invalid input is treated as already-redacted text
 */
const REDACTED = '[REDACTED]'

const QUERY_KEYS_TO_REDACT = new Set([
  'token', 'access_token', 'refresh_token', 'id_token', 'code', 'state',
  'apikey', 'api_key', 'api-key', 'secret', 'client_secret',
  'password', 'passwd', 'pwd', 'session', 'sessionid', 'session_id',
  'authorization', 'auth', 'bearer', 'jwt', 'csrf', 'xsrf',
])

const COOKIE_HEADERS = ['cookie', 'set-cookie', 'authorization', 'proxy-authorization']
const HEADER_PATTERNS = [
  /^cookie\s*:\s*.+$/gim,
  /^set-cookie\s*:\s*.+$/gim,
  /^authorization\s*:\s*.+$/gim,
  /^proxy-authorization\s*:\s*.+$/gim,
]

export function redactUrl(value: string | undefined | null): string {
  if (!value) return value ?? ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  // User info present (user:pass@) → drop the user info entirely.
  let working = trimmed.replace(/\/\/[^/]*@/, '//[REDACTED]@')
  if (working.includes('?')) {
    const [base, query] = working.split('?', 2)
    const filtered = query
      .split('&')
      .filter(part => {
        const key = part.split('=', 1)[0]?.toLowerCase()
        return !key || !QUERY_KEYS_TO_REDACT.has(key)
      })
      .join('&')
    working = filtered ? `${base}?${filtered}` : base
  }
  if (working.includes('#')) {
    const [base, fragment] = working.split('#', 2)
    // Fragments are almost always client-only state (OAuth tokens, etc.).
    working = `${base}#${REDACTED}`
    void fragment
  }
  return working
}

export function redactHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (COOKIE_HEADERS.includes(key.toLowerCase())) out[key] = REDACTED
    else out[key] = value
  }
  return out
}

export function redactLogLine(line: string | undefined | null): string {
  if (!line) return line ?? ''
  let working = line
  // URL form: keep the protocol + host but redact query / fragment / userinfo.
  working = working.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s)]+/gi, match => redactUrl(match))
  for (const pattern of HEADER_PATTERNS) {
    working = working.replace(pattern, (match) => match.split(':')[0] + ': ' + REDACTED)
  }
  // Bare query-like substrings: token=abc123 → token=[REDACTED]
  working = working.replace(/\b([a-z_-]{3,32})=([^\s&]+)/gi, (full, key) => {
    return QUERY_KEYS_TO_REDACT.has(String(key).toLowerCase()) ? `${key}=${REDACTED}` : full
  })
  return working
}

export function redactSessionTabs<T extends { url?: string }>(tabs: T[]): T[] {
  return tabs.map(tab => tab.url ? { ...tab, url: redactUrl(tab.url) } : tab)
}