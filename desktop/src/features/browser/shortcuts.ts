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
  | 'find'
  | 'openTabSearch'
  | 'openHistorySearch'
  | 'openBookmarks'
  | 'addBookmark'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'print'

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
  if (modifier && lower === 'l') return 'focusAddress'
  if (modifier && lower === 'f') return 'find'
  if (modifier && (lower === 'k' || (event.shiftKey && lower === 'a'))) return 'openTabSearch'
  if (modifier && lower === 'h') return 'openHistorySearch'
  if (modifier && event.shiftKey && lower === 'o') return 'openBookmarks'
  if (modifier && lower === 'd') return 'addBookmark'
  if (modifier && lower === 'p') return 'print'
  if (modifier && (key === '+' || key === '=')) return 'zoomIn'
  if (modifier && key === '-') return 'zoomOut'
  if (modifier && key === '0') return 'zoomReset'
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
