/**
 * Pure decoder for the BrowserPage keyboard shortcuts documented in §5.2 of
 * the technical guide. Extracted so the full key→action matrix can be
 * unit-tested without rendering the React tree.
 */
export type ShortcutAction =
  | 'focusAddress'
  | 'newTab'
  | 'reopenClosedTab'
  | 'closeTab'
  | 'nextTab'
  | 'prevTab'
  | 'jumpToTab'
  | 'back'
  | 'forward'
  | 'reload'
  | 'stop'

export interface ShortcutEvent {
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  key: string
}

export function interpretShortcut(event: ShortcutEvent): ShortcutAction | null {
  const modifier = event.ctrlKey || event.metaKey
  const key = event.key
  const lower = key.toLowerCase()
  if (modifier && event.shiftKey && lower === 't') return 'reopenClosedTab'
  if (modifier && lower === 't') return 'newTab'
  if (modifier && lower === 'w') return 'closeTab'
  if (modifier && lower === 'tab') return event.shiftKey ? 'prevTab' : 'nextTab'
  if (modifier && /^[1-9]$/.test(key)) return 'jumpToTab'
  if (event.altKey && key === 'ArrowLeft') return 'back'
  if (event.altKey && key === 'ArrowRight') return 'forward'
  if (key === 'F5' || (modifier && lower === 'r')) return 'reload'
  if (key === 'Escape') return 'stop'
  return null
}