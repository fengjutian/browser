export function parseStringMap(raw: string, label: string): Record<string, string> {
  if (!raw.trim()) return {}
  let parsed: unknown
  try { parsed = JSON.parse(raw) }
  catch { throw new Error(`${label}必须是有效的 JSON 对象`) }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(`${label}必须是 JSON 对象`)
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.trim() || typeof value !== 'string') throw new Error(`${label}中的键和值都必须是字符串`)
    result[key] = value
  }
  return result
}

export function parseArguments(raw: string): string[] {
  return raw.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
}

export function formatStringMap(value: Record<string, string>): string {
  return Object.keys(value).length ? JSON.stringify(value, null, 2) : ''
}
