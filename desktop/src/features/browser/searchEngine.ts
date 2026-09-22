/**
 * Persisted search-engine configuration. Users can pick a preset or supply
 * a custom template; the template MUST include `{query}` (enforced by
 * `isSearchTemplateValid`). The active id is stored under
 * `browser.searchEngine.v1` in localStorage.
 */
import { DEFAULT_SEARCH_ENGINE, isSearchTemplateValid } from './navigation'

export interface SearchEnginePreset {
  id: string
  label: string
  template: string
}

export const SEARCH_ENGINE_PRESETS: SearchEnginePreset[] = [
  { id: 'google',  label: 'Google',   template: 'https://www.google.com/search?q={query}' },
  { id: 'bing',    label: 'Bing',     template: 'https://www.bing.com/search?q={query}' },
  { id: 'baidu',   label: '百度',      template: 'https://www.baidu.com/s?wd={query}' },
  { id: 'duckduckgo', label: 'DuckDuckGo', template: 'https://duckduckgo.com/?q={query}' },
]

export const SEARCH_ENGINE_STORAGE_KEY = 'browser.searchEngine.v1'

export interface SearchEngineConfig {
  presetId: string
  customTemplate?: string
}

export const DEFAULT_SEARCH_ENGINE_CONFIG: SearchEngineConfig = { presetId: 'google' }

function isConfig(value: unknown): value is SearchEngineConfig {
  return !!value && typeof value === 'object' && typeof (value as SearchEngineConfig).presetId === 'string'
}

export function readSearchEngineConfig(): SearchEngineConfig {
  try {
    const raw = localStorage.getItem(SEARCH_ENGINE_STORAGE_KEY)
    if (!raw) return DEFAULT_SEARCH_ENGINE_CONFIG
    const parsed = JSON.parse(raw)
    if (!isConfig(parsed)) return DEFAULT_SEARCH_ENGINE_CONFIG
    if (parsed.customTemplate && !isSearchTemplateValid(parsed.customTemplate)) {
      // Drop the bad custom template but keep the preset id.
      return { presetId: parsed.presetId }
    }
    return parsed
  } catch {
    return DEFAULT_SEARCH_ENGINE_CONFIG
  }
}

export function writeSearchEngineConfig(config: SearchEngineConfig): SearchEngineConfig {
  const sanitized: SearchEngineConfig = { presetId: config.presetId }
  if (config.customTemplate) {
    if (!isSearchTemplateValid(config.customTemplate)) {
      throw new Error('search engine template must contain {query}')
    }
    sanitized.customTemplate = config.customTemplate
  }
  localStorage.setItem(SEARCH_ENGINE_STORAGE_KEY, JSON.stringify(sanitized))
  return sanitized
}

export function resolveActiveSearchTemplate(config: SearchEngineConfig = readSearchEngineConfig()): string {
  if (config.presetId === 'custom' && config.customTemplate && isSearchTemplateValid(config.customTemplate)) {
    return config.customTemplate
  }
  const preset = SEARCH_ENGINE_PRESETS.find(p => p.id === config.presetId)
  if (preset) return preset.template
  return DEFAULT_SEARCH_ENGINE
}