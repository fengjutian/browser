export const MCP_PROTOCOL_VERSION = '2026-07-28'

export interface McpRequest { jsonrpc:'2.0'; id:number; method:string; params?:Record<string,unknown> }

export function buildMcpRequest(id:number, method:string, params?:Record<string,unknown>) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('MCP request id must be a positive integer')
  if (!method.trim()) throw new Error('MCP method is required')
  const request: McpRequest = { jsonrpc:'2.0', id, method, ...(params ? {params} : {}) }
  const headers: Record<string,string> = {
    'Content-Type':'application/json', Accept:'application/json, text/event-stream',
    'MCP-Protocol-Version':MCP_PROTOCOL_VERSION, 'Mcp-Method':method,
  }
  const name = typeof params?.name === 'string' ? params.name : typeof params?.uri === 'string' ? params.uri : undefined
  if (name) headers['Mcp-Name'] = name
  return { request, headers }
}

export function parseMcpResponse(raw:string): unknown {
  const trimmed = raw.trim()
  const payload = /(^|\n)data:/.test(trimmed)
    ? trimmed.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).find(line=>line && line !== '[DONE]')
    : trimmed
  if (!payload) throw new Error('MCP server returned an empty response')
  const parsed = JSON.parse(payload) as { error?:{code?:number;message?:string}; result?:unknown }
  if (parsed.error) throw new Error(`MCP ${parsed.error.code ?? 'error'}: ${parsed.error.message ?? 'request failed'}`)
  return parsed.result
}
