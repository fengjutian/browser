import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSearchEngineConfig, resolveActiveSearchTemplate, SEARCH_ENGINE_PRESETS, SEARCH_ENGINE_STORAGE_KEY, writeSearchEngineConfig } from './searchEngine'

describe('searchEngine config', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('returns the default when nothing is stored', () => {
    expect(readSearchEngineConfig().presetId).toBe('google')
  })

  it('persists and reads preset id', () => {
    writeSearchEngineConfig({ presetId: 'baidu' })
    expect(readSearchEngineConfig().presetId).toBe('baidu')
  })

  it('persists custom templates', () => {
    writeSearchEngineConfig({ presetId: 'custom', customTemplate: 'https://kagi.com/search?q={query}' })
    const cfg = readSearchEngineConfig()
    expect(cfg.presetId).toBe('custom')
    expect(cfg.customTemplate).toBe('https://kagi.com/search?q={query}')
  })

  it('rejects custom templates missing {query}', () => {
    expect(() => writeSearchEngineConfig({ presetId: 'custom', customTemplate: 'https://example.com/' }))
      .toThrow(/\{query\}/)
  })

  it('drops a corrupted custom template but keeps preset id', () => {
    localStorage.setItem(SEARCH_ENGINE_STORAGE_KEY, JSON.stringify({ presetId: 'baidu', customTemplate: 'no-placeholder' }))
    const cfg = readSearchEngineConfig()
    expect(cfg.presetId).toBe('baidu')
    expect(cfg.customTemplate).toBeUndefined()
  })

  it('falls back to default template when the stored preset id is unknown', () => {
    localStorage.setItem(SEARCH_ENGINE_STORAGE_KEY, JSON.stringify({ presetId: 'unknown' }))
    const template = resolveActiveSearchTemplate()
    expect(template).toContain('{query}')
  })

  it('lists every preset with a {query} placeholder', () => {
    for (const preset of SEARCH_ENGINE_PRESETS) {
      expect(preset.template).toContain('{query}')
    }
  })

  it('survives corrupted JSON', () => {
    localStorage.setItem(SEARCH_ENGINE_STORAGE_KEY, 'garbage')
    expect(readSearchEngineConfig().presetId).toBe('google')
  })
})