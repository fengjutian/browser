import { describe, expect, it } from 'vitest'
import { parseAgentSteps } from './AgentRunHistory'

describe('parseAgentSteps', () => {
  it('parses a stored step list', () => {
    const steps = parseAgentSteps('[{"index":1,"kind":"search","summary":"found 2","at":"2026-10-07"}]')
    expect(steps).toHaveLength(1)
    expect(steps[0].kind).toBe('search')
  })

  it('returns an empty list for malformed or empty history', () => {
    expect(parseAgentSteps('not json')).toEqual([])
    expect(parseAgentSteps('')).toEqual([])
    expect(parseAgentSteps('{"not":"an array"}')).toEqual([])
  })
})