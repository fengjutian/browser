import { describe, expect, it } from 'vitest'
import { decideTabSync, TAB_SYNC_FAILURE_THRESHOLD } from './tabSyncReducer'
import type { NativeBrowserState } from '../../services/nativeBrowser'

const makeState = (overrides: Partial<NativeBrowserState> = {}): NativeBrowserState => ({
  url: 'https://example.com',
  title: 'Example',
  loading: false,
  scrollX: 0,
  scrollY: 0,
  canGoBack: true,
  canGoForward: false,
  ...overrides,
})

describe('decideTabSync', () => {
  it('applies the polled state when present', () => {
    const decision = decideTabSync({
      state: makeState({ url: 'https://example.com/a', scrollY: 240 }),
      isAlive: true,
      previousFailures: 0,
      fallbackTitle: 'Fallback',
    })
    expect(decision.kind).toBe('apply')
    if (decision.kind !== 'apply') return
    expect(decision.patch).toMatchObject({
      url: 'https://example.com/a',
      title: 'Example',
      scrollY: 240,
      canGoBack: true,
    })
  })

  it('falls back to the provided title when state.title is empty', () => {
    const decision = decideTabSync({
      state: makeState({ title: '' }),
      isAlive: true,
      previousFailures: 0,
      fallbackTitle: '新标签页',
    })
    expect(decision.kind).toBe('apply')
    if (decision.kind !== 'apply') return
    expect(decision.patch.title).toBe('新标签页')
  })

  it('only restores pending scroll once the page finishes loading', () => {
    const pending = { x: 0, y: 800 }
    const loading = decideTabSync({
      state: makeState({ loading: true }),
      isAlive: true,
      previousFailures: 0,
      pendingScroll: pending,
      fallbackTitle: '新标签页',
    })
    expect(loading.kind).toBe('apply')
    if (loading.kind !== 'apply') return
    expect(loading.restoreScroll).toBeUndefined()

    const ready = decideTabSync({
      state: makeState({ loading: false }),
      isAlive: true,
      previousFailures: 0,
      pendingScroll: pending,
      fallbackTitle: '新标签页',
    })
    expect(ready.kind).toBe('apply')
    if (ready.kind !== 'apply') return
    expect(ready.restoreScroll).toEqual(pending)
  })

  it('bumps failure counter when the poll returns no state', () => {
    const decision = decideTabSync({
      state: null,
      isAlive: true,
      previousFailures: 1,
      fallbackTitle: '新标签页',
    })
    expect(decision.kind).toBe('bumpFailure')
    if (decision.kind !== 'bumpFailure') return
    expect(decision.failures).toBe(2)
  })

  it('asks the hook to reopen once failures reach the threshold AND the webview is dead', () => {
    const decision = decideTabSync({
      state: null,
      isAlive: false,
      previousFailures: TAB_SYNC_FAILURE_THRESHOLD - 1,
      fallbackTitle: '新标签页',
    })
    expect(decision.kind).toBe('reopen')
    if (decision.kind !== 'reopen') return
    expect(decision.failures).toBe(0)
  })

  it('keeps bumping when the webview is still alive', () => {
    const decision = decideTabSync({
      state: null,
      isAlive: true,
      previousFailures: TAB_SYNC_FAILURE_THRESHOLD,
      fallbackTitle: '新标签页',
    })
    expect(decision.kind).toBe('bumpFailure')
  })
})