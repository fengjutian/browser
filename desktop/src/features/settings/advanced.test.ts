import { describe, expect, it, beforeEach } from 'vitest'
import {
  ADVANCED_SETTINGS_EVENT,
  ADVANCED_SETTINGS_KEY,
  DEFAULT_ADVANCED_SETTINGS,
  readAdvancedSettings,
  writeAdvancedSettings,
} from './advanced'

describe('advanced settings', () => {
  beforeEach(() => {
    localStorage.removeItem(ADVANCED_SETTINGS_KEY)
    document.body.dataset.reduceMotion = 'false'
  })

  it('returns defaults when no entry exists', () => {
    const settings = readAdvancedSettings()
    expect(settings).toEqual(DEFAULT_ADVANCED_SETTINGS)
    expect(settings.maxLiveWebviews).toBe(8)
    expect(settings.backgroundPollingEnabled).toBe(true)
    expect(settings.backgroundPollIntervalMs).toBe(3000)
    expect(settings.idleSuspendMinutes).toBe(30)
  })

  it('clamps extreme values back into the supported range', () => {
    localStorage.setItem(ADVANCED_SETTINGS_KEY, JSON.stringify({
      maxLiveWebviews: 0,
      backgroundPollIntervalMs: 50,
      idleSuspendMinutes: 9999,
    }))
    const settings = readAdvancedSettings()
    expect(settings.maxLiveWebviews).toBe(2)
    expect(settings.backgroundPollIntervalMs).toBe(1000)
    expect(settings.idleSuspendMinutes).toBe(180)
  })

  it('honours explicit user overrides within range', () => {
    localStorage.setItem(ADVANCED_SETTINGS_KEY, JSON.stringify({
      backgroundPollingEnabled: false,
      backgroundPollIntervalMs: 5000,
      idleSuspendMinutes: 5,
    }))
    const settings = readAdvancedSettings()
    expect(settings.backgroundPollingEnabled).toBe(false)
    expect(settings.backgroundPollIntervalMs).toBe(5000)
    expect(settings.idleSuspendMinutes).toBe(5)
  })

  it('writeAdvancedSettings persists + reflects on data attribute + dispatches event', () => {
    const next = { ...DEFAULT_ADVANCED_SETTINGS, reduceMotion: true }
    let received: typeof next | null = null
    const handler = (event: Event) => { received = (event as CustomEvent<typeof next>).detail }
    window.addEventListener(ADVANCED_SETTINGS_EVENT, handler as EventListener)
    writeAdvancedSettings(next)
    expect(document.body.dataset.reduceMotion).toBe('true')
    expect(readAdvancedSettings()).toEqual(next)
    expect(received).toEqual(next)
    window.removeEventListener(ADVANCED_SETTINGS_EVENT, handler as EventListener)
  })
})