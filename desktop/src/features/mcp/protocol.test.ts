import { describe,expect,it } from 'vitest'
import { buildMcpRequest, MCP_PROTOCOL_VERSION, parseMcpResponse } from './protocol'

describe('MCP 2026-07-28 protocol',()=>{
  it('adds routing headers for a tool call',()=>{
    const value=buildMcpRequest(1,'tools/call',{name:'search',arguments:{q:'x'}})
    expect(value.headers['MCP-Protocol-Version']).toBe(MCP_PROTOCOL_VERSION)
    expect(value.headers['Mcp-Method']).toBe('tools/call')
    expect(value.headers['Mcp-Name']).toBe('search')
  })
  it('parses JSON and SSE JSON-RPC results',()=>{
    expect(parseMcpResponse('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}')).toEqual({tools:[]})
    expect(parseMcpResponse('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n')).toEqual({ok:true})
  })
  it('surfaces protocol errors',()=>expect(()=>parseMcpResponse('{"error":{"code":-1,"message":"denied"}}')).toThrow('denied'))
})
