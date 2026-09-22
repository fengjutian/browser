import { describe, expect, it } from 'vitest'
import { classifyNavigationInput, DEFAULT_SEARCH_ENGINE, isSearchTemplateValid, renderSearchTemplate, resolveNavigationInput } from './navigation'

describe('resolveNavigationInput', () => {
  it('keeps http urls', () => expect(resolveNavigationInput('http://example.com/a')).toBe('http://example.com/a'))
  it('adds https to domains', () => expect(resolveNavigationInput('example.com/docs')).toBe('https://example.com/docs'))
  it('supports localhost ports', () => expect(resolveNavigationInput('localhost:5173')).toBe('https://localhost:5173'))
  it('searches ordinary text', () => expect(resolveNavigationInput('tauri browser')).toBe('https://www.google.com/search?q=tauri%20browser'))
  it('preserves unsupported schemes for the protocol error UI', () => expect(resolveNavigationInput('mailto:test@example.com')).toBe('mailto:test@example.com'))
  it('ignores blank input', () => expect(resolveNavigationInput('   ')).toBeNull())
  it('honours the active search engine template', () => {
    expect(resolveNavigationInput('keyword', { searchTemplate: 'https://duckduckgo.com/?q={query}' }))
      .toBe('https://duckduckgo.com/?q=keyword')
  })
  it('falls back when the template is missing {query}', () => {
    expect(resolveNavigationInput('foo', { searchTemplate: 'https://example.com/' }))
      .toBe(`${DEFAULT_SEARCH_ENGINE.split('?')[0]}?q=foo`)
  })
  it('uses the history protocol hint for bare domains', () => {
    expect(resolveNavigationInput('example.com', { historyProtocolHint: 'http' })).toBe('http://example.com')
  })
})

describe('classifyNavigationInput', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['https://example.com', 'https-url'],
    ['http://example.com', 'http-url'],
    ['example.com', 'domain'],
    ['localhost:5173', 'domain'],
    ['mailto:test@example.com', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['hello world', 'search'],
  ])('classifies %p as %p', (input, expected) => {
    expect(classifyNavigationInput(input)).toBe(expected)
  })
})

describe('isSearchTemplateValid', () => {
  it('requires the {query} placeholder', () => {
    expect(isSearchTemplateValid('https://www.google.com/search?q={query}')).toBe(true)
    expect(isSearchTemplateValid('https://example.com/')).toBe(false)
  })
})

describe('renderSearchTemplate', () => {
  it('encodes the query value', () => {
    expect(renderSearchTemplate('https://duckduckgo.com/?q={query}', 'foo bar')).toBe('https://duckduckgo.com/?q=foo%20bar')
  })
})