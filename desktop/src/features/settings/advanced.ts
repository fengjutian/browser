export interface AdvancedSettings {
  maxLiveWebviews: number
  reduceMotion: boolean
  safetyWarnings: boolean
  backgroundPollingEnabled: boolean
  backgroundPollIntervalMs: number
  idleSuspendMinutes: number
}

export const ADVANCED_SETTINGS_KEY = 'arcadia-advanced-settings.v1'
export const ADVANCED_SETTINGS_EVENT = 'arcadia-advanced-settings-change'
export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettings = {
  maxLiveWebviews: 8,
  reduceMotion: false,
  safetyWarnings: true,
  backgroundPollingEnabled: true,
  backgroundPollIntervalMs: 3000,
  idleSuspendMinutes: 30,
}

export function readAdvancedSettings(): AdvancedSettings {
  try {
    const value = JSON.parse(localStorage.getItem(ADVANCED_SETTINGS_KEY) ?? '{}') as Partial<AdvancedSettings>
    return {
      maxLiveWebviews: Math.min(16, Math.max(2, Math.round(value.maxLiveWebviews ?? 8))),
      reduceMotion: value.reduceMotion === true,
      safetyWarnings: value.safetyWarnings !== false,
      backgroundPollingEnabled: value.backgroundPollingEnabled !== false,
      backgroundPollIntervalMs: Math.min(15000, Math.max(1000, Math.round(value.backgroundPollIntervalMs ?? 3000))),
      idleSuspendMinutes: Math.min(180, Math.max(1, Math.round(value.idleSuspendMinutes ?? 30))),
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
