/**
 * Pure decoder + editable binding table for the BrowserPage keyboard shortcuts
 * documented in §5.2 of the technical guide. Extracted so the full
 * key→action matrix can be unit-tested without rendering the React tree, and so
 * users can rebind any action from Settings → 快捷键.
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
  | 'openBulkSummary'
  | 'toggleNotesPanel'
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

/**
 * A single shortcut binding. `ctrl` covers both Ctrl (Windows/Linux) and ⌘
 * (macOS) — most browsers treat them as the same primary modifier and so do
 * we, keeping the editor simple.
 */
export interface ShortcutBinding {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
}

export interface ShortcutDefinition {
  action: ShortcutAction
  /** User-facing label, Chinese for the settings UI. */
  label: string
  /** Hard-coded fallback used when the user has not overridden this action. */
  default: ShortcutBinding
  /**
   * Extra default bindings (e.g. `openTabSearch` accepts Ctrl+K and Ctrl+Shift+A).
   * Only used while the action is on its factory defaults; overridden actions
   * drop every default to avoid binding collisions.
   */
  extras?: ShortcutBinding[]
  /** Short hint shown next to the row (e.g. "标签搜索"). */
  hint: string
}

const kbd = (key: string, ctrl = true, shift = false, alt = false): ShortcutBinding => ({ key, ctrl, shift, alt })

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  { action: 'focusAddress',      label: '聚焦地址栏',       hint: 'Ctrl/⌘ + L',          default: kbd('l') },
  { action: 'find',              label: '页内查找',         hint: 'Ctrl/⌘ + F',          default: kbd('f') },
  { action: 'print',             label: '打印当前页',       hint: 'Ctrl/⌘ + P',          default: kbd('p') },
  { action: 'zoomIn',            label: '放大页面',         hint: 'Ctrl/⌘ + +',          default: kbd('+') },
  { action: 'zoomOut',           label: '缩小页面',         hint: 'Ctrl/⌘ + -',          default: kbd('-') },
  { action: 'zoomReset',         label: '重置缩放',         hint: 'Ctrl/⌘ + 0',          default: kbd('0') },
  { action: 'newTab',            label: '新建标签',         hint: 'Ctrl/⌘ + T',          default: kbd('t') },
  { action: 'reopenClosedTab',   label: '恢复关闭的标签',   hint: 'Ctrl/⌘ + Shift + T',  default: kbd('t', true, true) },
  { action: 'closeTab',          label: '关闭当前标签',     hint: 'Ctrl/⌘ + W',          default: kbd('w') },
  { action: 'nextTab',           label: '下一个标签',       hint: 'Ctrl/⌘ + Tab',        default: kbd('Tab') },
  { action: 'prevTab',           label: '上一个标签',       hint: 'Ctrl/⌘ + Shift + Tab',default: kbd('Tab', true, true) },
  { action: 'jumpToTab',         label: '跳转到第 N 个标签',hint: 'Ctrl/⌘ + 1~9',        default: kbd('1') },
  { action: 'openTabSearch',     label: '打开标签搜索面板', hint: 'Ctrl/⌘ + K /  + Shift+ A', default: kbd('k'), extras: [kbd('a', true, true)] },
  { action: 'openHistorySearch', label: '打开历史搜索面板', hint: 'Ctrl/⌘ + H',          default: kbd('h') },
  { action: 'openBookmarks',     label: '打开收藏夹面板',   hint: 'Ctrl/⌘ + Shift + O',  default: kbd('o', true, true) },
  { action: 'addBookmark',       label: '收藏当前页',       hint: 'Ctrl/⌘ + D',          default: kbd('d') },
  { action: 'openBulkSummary',   label: '多链接 AI 摘要',    hint: 'Ctrl/⌘ + Shift + S',  default: kbd('s', true, true) },
  { action: 'toggleNotesPanel',  label: '切换网页笔记面板', hint: 'Ctrl/⌘ + Shift + N',  default: kbd('n', true, true) },
  { action: 'back',              label: '后退',             hint: 'Alt + ←',              default: kbd('ArrowLeft', false, false, true) },
  { action: 'forward',           label: '前进',             hint: 'Alt + →',              default: kbd('ArrowRight', false, false, true) },
  { action: 'reload',            label: '刷新当前页',       hint: 'F5 / Ctrl/⌘ + R',     default: kbd('F5', false) },
  { action: 'stop',              label: '停止加载',         hint: 'Esc',                  default: kbd('Escape', false) },
] as const

const STORAGE_KEY = 'arcadia-shortcut-overrides'
export const SHORTCUT_OVERRIDES_EVENT = 'arcadia-shortcut-overrides-change'

export type ShortcutOverrides = Partial<Record<ShortcutAction, ShortcutBinding>>

function isBinding(value: unknown): value is ShortcutBinding {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.key === 'string' && typeof v.ctrl === 'boolean' && typeof v.shift === 'boolean' && typeof v.alt === 'boolean'
}

/**
 * Reads the user overrides from localStorage. Invalid entries are dropped
 * silently so a corrupted settings file cannot brick the keyboard layer.
 */
export function readShortcutOverrides(): ShortcutOverrides {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: ShortcutOverrides = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isBinding(v)) out[k as ShortcutAction] = v
    }
    return out
  } catch {
    return {}
  }
}

export function writeShortcutOverrides(value: ShortcutOverrides): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ShortcutOverrides>(SHORTCUT_OVERRIDES_EVENT, { detail: value }))
  }
}

export function clearShortcutOverride(action: ShortcutAction): void {
  const next = { ...readShortcutOverrides() }
  delete next[action]
  writeShortcutOverrides(next)
}

export function resetAllShortcutOverrides(): void {
  writeShortcutOverrides({})
}

/**
 * True when the keyboard event matches the binding. `ctrl` covers either Ctrl
 * or ⌘ to keep cross-platform usability without doubling the editor surface.
 */
export function matchBinding(event: ShortcutEvent, binding: ShortcutBinding): boolean {
  const primary = event.ctrlKey || event.metaKey
  if (binding.ctrl !== primary) return false
  if (binding.shift !== event.shiftKey) return false
  if (binding.alt !== event.altKey) return false
  return event.key.toLowerCase() === binding.key.toLowerCase()
}

/**
 * Resolve a key event to an action. Overrides win over defaults when the
 * action is present in the override map; if no override matches, the hard-
 * coded defaults are consulted. An action that has been overridden drops
 * ALL of its defaults so the original key does not silently keep firing.
 */
export function interpretShortcut(event: ShortcutEvent, overrides: ShortcutOverrides = {}): ShortcutAction | null {
  for (const action of Object.keys(overrides) as ShortcutAction[]) {
    const binding = overrides[action]
    if (binding && matchBinding(event, binding)) return action
  }
  for (const def of SHORTCUT_DEFINITIONS) {
    if (def.action in overrides) continue
    if (matchBinding(event, def.default)) return def.action
    if (def.extras) {
      for (const extra of def.extras) {
        if (matchBinding(event, extra)) return def.action
      }
    }
  }
  return null
}

const KEY_DISPLAY: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  Tab: 'Tab',
  ' ': 'Space',
  Enter: 'Enter',
}

/** Normalize a binding to a user-facing display ("Ctrl + Shift + A"). */
export function bindingToDisplay(binding: ShortcutBinding): string {
  const parts: string[] = []
  if (binding.ctrl) parts.push('Ctrl')
  if (binding.alt) parts.push('Alt')
  if (binding.shift) parts.push('Shift')
  const displayKey = KEY_DISPLAY[binding.key] ?? (binding.key.length === 1 ? binding.key.toUpperCase() : binding.key)
  parts.push(displayKey)
  return parts.join(' + ')
}

/**
 * Returns true when the action is bound to a different key than its default,
 * i.e. the user has personalised it.
 */
export function isOverridden(action: ShortcutAction, overrides: ShortcutOverrides): boolean {
  return action in overrides
}

export function defaultBinding(action: ShortcutAction): ShortcutBinding {
  const def = SHORTCUT_DEFINITIONS.find(item => item.action === action)
  if (!def) throw new Error(`unknown shortcut action: ${action}`)
  return { ...def.default }
}