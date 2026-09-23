export interface AdvancedSettings {
  maxLiveWebviews: number
  reduceMotion: boolean
  safetyWarnings: boolean
}

export const ADVANCED_SETTINGS_KEY = 'arcadia-advanced-settings.v1'
export const ADVANCED_SETTINGS_EVENT = 'arcadia-advanced-settings-change'
export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettings = {
  maxLiveWebviews: 8,
  reduceMotion: false,
  safetyWarnings: true,
}

export function readAdvancedSettings(): AdvancedSettings {
  try {
    const value = JSON.parse(localStorage.getItem(ADVANCED_SETTINGS_KEY) ?? '{}') as Partial<AdvancedSettings>
    return {
      maxLiveWebviews: Math.min(16, Math.max(2, Math.round(value.maxLiveWebviews ?? 8))),
      reduceMotion: value.reduceMotion === true,
      safetyWarnings: value.safetyWarnings !== false,
    }
  } catch {
    return DEFAULT_ADVANCED_SETTINGS
  }
}

export function writeAdvancedSettings(settings: AdvancedSettings): void {
  localStorage.setItem(ADVANCED_SETTINGS_KEY, JSON.stringify(settings))
  document.body.dataset.reduceMotion = settings.reduceMotion ? 'true' : 'false'
  window.dispatchEvent(new CustomEvent<AdvancedSettings>(ADVANCED_SETTINGS_EVENT, { detail: settings }))
}
