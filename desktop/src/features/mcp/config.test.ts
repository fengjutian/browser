import { describe, expect, it } from 'vitest'
import { formatStringMap, parseArguments, parseStringMap } from './config'

describe('MCP config helpers', () => {
  it('parses one stdio argument per line', () => {
    expect(parseArguments('--stdio\n./workspace\n\n')).toEqual(['--stdio', './workspace'])
  })

  it('accepts only string maps', () => {
    expect(parseStringMap('{"TOKEN":"secret"}', '环境变量')).toEqual({ TOKEN: 'secret' })
    expect(() => parseStringMap('["bad"]', '环境变量')).toThrow('JSON 对象')
    expect(() => parseStringMap('{"PORT":123}', '环境变量')).toThrow('字符串')
  })

  it('formats empty and populated maps for editing', () => {
    expect(formatStringMap({})).toBe('')
    expect(formatStringMap({ Authorization: 'Bearer token' })).toContain('Authorization')
  })
})
