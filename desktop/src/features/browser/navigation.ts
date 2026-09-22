const SCHEME_RE = /^[a-z][a-z\d+.-]*:/i
const HOST_RE = /^(?:localhost|(?:[a-z\d-]+\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#].*)?$/i

export function resolveNavigationInput(input: string, searchBase = 'https://www.google.com/search'): string | null {
  const value = input.trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  if (!/\s/.test(value) && HOST_RE.test(value)) return `https://${value}`
  if (SCHEME_RE.test(value)) return value
  return `${searchBase}?q=${encodeURIComponent(value)}`
}
