import { describe, expect, it } from 'vitest'
import { resolveNavigationInput } from './navigation'

describe('resolveNavigationInput', () => {
  it('keeps http urls', () => expect(resolveNavigationInput('http://example.com/a')).toBe('http://example.com/a'))
  it('adds https to domains', () => expect(resolveNavigationInput('example.com/docs')).toBe('https://example.com/docs'))
  it('supports localhost ports', () => expect(resolveNavigationInput('localhost:5173')).toBe('https://localhost:5173'))
  it('searches ordinary text', () => expect(resolveNavigationInput('tauri browser')).toBe('https://www.google.com/search?q=tauri%20browser'))
  it('preserves unsupported schemes for the protocol error UI', () => expect(resolveNavigationInput('mailto:test@example.com')).toBe('mailto:test@example.com'))
  it('ignores blank input', () => expect(resolveNavigationInput('   ')).toBeNull())
})
