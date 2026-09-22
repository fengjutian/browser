/**
 * Pure navigation resolver. Given an address-bar input string and the
 * currently active search engine template, decide whether the user typed a
 * URL, a domain, a scheme-prefixed external call, or a search query.
 *
 * The function is intentionally pure so it can be unit-tested without any
 * browser state. `BrowserPage` passes the active template; this module
 * never reads `localStorage` directly.
 *
 * Rule order:
 *   1. Empty input → null
 *   2. Already starts with http/https → keep
 *   3. Looks like a host (no spaces, matches HOST_RE) → if input already
 *      has an explicit scheme, keep it; otherwise prepend the protocol
 *      found in `historyProtocolHint` (default: https)
 *   4. Starts with a custom scheme → return as-is (Rust will reject
 *      dangerous ones later)
 *   5. Otherwise → treat as search query, expand against `searchTemplate`
 */

const SCHEME_RE = /^[a-z][a-z\d+.-]*:/i
const HOST_RE = /^(?:localhost|(?:[a-z\d-]+\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#].*)?$/i

export const DEFAULT_SEARCH_ENGINE = 'https://www.google.com/search?q={query}'

export function isSearchTemplateValid(template: string): boolean {
  return template.includes('{query}')
}

export function renderSearchTemplate(template: string, query: string): string {
  return template.replace('{query}', encodeURIComponent(query))
}

export interface ResolveOptions {
  searchTemplate?: string
  /** Protocol to prepend when the input is bare-host (default "https"). */
  historyProtocolHint?: 'http' | 'https'
}

export function resolveNavigationInput(input: string, options: ResolveOptions = {}): string | null {
  const value = input.trim()
  if (!value) return null
  const searchTemplate = options.searchTemplate ?? DEFAULT_SEARCH_ENGINE
  if (/^https?:\/\//i.test(value)) return value
  if (!/\s/.test(value) && HOST_RE.test(value)) {
    const scheme = options.historyProtocolHint ?? 'https'
    return `${scheme}://${value}`
  }
  if (SCHEME_RE.test(value)) return value
  if (!isSearchTemplateValid(searchTemplate)) {
    // Fall back to a default rather than emit a broken URL.
    return renderSearchTemplate(DEFAULT_SEARCH_ENGINE, value)
  }
  return renderSearchTemplate(searchTemplate, value)
}

/**
 * Categorise the input the user typed. The address bar uses this to decide
 * whether to show the safety warning or the search hint.
 */
export type InputKind = 'http-url' | 'https-url' | 'domain' | 'scheme' | 'search' | 'empty'

export function classifyNavigationInput(input: string): InputKind {
  const value = input.trim()
  if (!value) return 'empty'
  if (/^https:\/\//i.test(value)) return 'https-url'
  if (/^http:\/\//i.test(value)) return 'http-url'
  if (!/\s/.test(value) && HOST_RE.test(value)) return 'domain'
  if (SCHEME_RE.test(value)) return 'scheme'
  return 'search'
}