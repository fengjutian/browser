/**
 * Pure builders for the browser's right-click context menu. Each region
 * (page / selection / link / image / input) returns its own item list with
 * `enabled` flags reflecting URL safety and capability checks. The
 * component layer maps these into the local menu adapter so that the
 * state machine stays testable without rendering React.
 */
import type { ContextMenuRequest } from '../../services/nativeBrowser'
import { isAllowedExternalUrl } from '../../services/nativeBrowser'
import { classifyShellOpenUrl } from './externalSchemes'

export type ContextMenuRegion = ContextMenuRequest['kind']

export type ContextMenuAction =
  | 'back'
  | 'forward'
  | 'reload'
  | 'stop'
  | 'print'
  | 'view-source'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'select-all'
  | 'search-selection'
  | 'ask-ai'
  | 'translate-selection'
  | 'add-to-notes'
  | 'open-link-current'
  | 'open-link-new'
  | 'open-link-external'
  | 'copy-link'
  | 'open-image-new'
  | 'copy-image'
  | 'save-image'

export interface ContextMenuItem {
  action: ContextMenuAction
  label: string
  shortcut?: string
  danger?: boolean
  divider?: false
  enabled: boolean
  /** Optional inline tooltip when disabled. */
  disabledReason?: string
}

export interface ContextMenuSection {
  items: ContextMenuItem[]
}

export interface ContextMenuBuild {
  sections: ContextMenuSection[]
  request: ContextMenuRequest
}

export interface ContextMenuCapabilities {
  canGoBack: boolean
  canGoForward: boolean
  canPrint: boolean
  canAskAi: boolean
}

const ALWAYS_ENABLED = true

export function buildContextMenu(
  request: ContextMenuRequest,
  capabilities: ContextMenuCapabilities,
): ContextMenuBuild {
  switch (request.kind) {
    case 'link':
      return { request, sections: buildLinkSections(request, capabilities) }
    case 'image':
      return { request, sections: buildImageSections(request, capabilities) }
    case 'selection':
      return { request, sections: buildSelectionSections(request, capabilities) }
    case 'input':
      return { request, sections: buildInputSections(request, capabilities) }
    case 'page':
    default:
      return { request, sections: buildPageSections(request, capabilities) }
  }
}

function buildPageSections(request: ContextMenuRequest, cap: ContextMenuCapabilities): ContextMenuSection[] {
  void request
  return [
    {
      items: [
        { action: 'back', label: '后退', shortcut: 'Alt+←', enabled: cap.canGoBack },
        { action: 'forward', label: '前进', shortcut: 'Alt+→', enabled: cap.canGoForward },
        { action: 'reload', label: '重新加载', shortcut: 'F5', enabled: ALWAYS_ENABLED },
        { action: 'stop', label: '停止加载', shortcut: 'Esc', enabled: ALWAYS_ENABLED },
      ],
    },
    {
      items: [
        { action: 'print', label: '打印', shortcut: 'Ctrl+P', enabled: cap.canPrint },
        { action: 'view-source', label: '查看页面信息', enabled: ALWAYS_ENABLED },
      ],
    },
  ]
}

function buildSelectionSections(request: ContextMenuRequest, cap: ContextMenuCapabilities): ContextMenuSection[] {
  const hasSelection = !!request.selectionText?.trim()
  return [
    {
      items: [
        { action: 'copy', label: '复制', shortcut: 'Ctrl+C', enabled: ALWAYS_ENABLED },
        { action: 'search-selection', label: '用搜索引擎搜索所选内容', enabled: ALWAYS_ENABLED },
        { action: 'add-to-notes', label: '加入笔记', enabled: hasSelection, disabledReason: hasSelection ? undefined : '请先选中文本' },
        { action: 'ask-ai', label: '向 AI 提问', enabled: cap.canAskAi, disabledReason: cap.canAskAi ? undefined : 'AI 功能尚未配置' },
        { action: 'translate-selection', label: '翻译选中内容', enabled: cap.canAskAi && hasSelection, disabledReason: cap.canAskAi ? undefined : 'AI 功能尚未配置' },
      ],
    },
  ]
}

function buildLinkSections(request: ContextMenuRequest, cap: ContextMenuCapabilities): ContextMenuSection[] {
  const url = request.linkUrl ?? ''
  const allowed = isAllowedExternalUrl(url)
  const shell = classifyShellOpenUrl(url)
  return [
    {
      items: [
        { action: 'open-link-current', label: '在当前标签打开', enabled: allowed, disabledReason: allowed ? undefined : '链接协议不安全' },
        { action: 'open-link-new', label: '在新标签打开', enabled: allowed, disabledReason: allowed ? undefined : '链接协议不安全' },
        { action: 'open-link-external', label: '在系统应用中打开', enabled: shell.shellOpenable, disabledReason: shell.shellOpenable ? undefined : '链接协议不支持' },
        { action: 'copy-link', label: '复制链接地址', enabled: ALWAYS_ENABLED },
      ],
    },
    {
      items: [
        { action: 'print', label: '打印', shortcut: 'Ctrl+P', enabled: cap.canPrint },
      ],
    },
  ]
}

function buildImageSections(request: ContextMenuRequest, cap: ContextMenuCapabilities): ContextMenuSection[] {
  const url = request.imageUrl ?? ''
  const allowed = isAllowedExternalUrl(url)
  return [
    {
      items: [
        { action: 'open-image-new', label: '在新标签打开图片', enabled: allowed, disabledReason: allowed ? undefined : '图片地址协议不安全' },
        { action: 'copy-image', label: '复制图片地址', enabled: ALWAYS_ENABLED },
        { action: 'save-image', label: '保存图片到下载中心', enabled: allowed, disabledReason: allowed ? undefined : '图片地址协议不安全' },
      ],
    },
  ]
}

function buildInputSections(_request: ContextMenuRequest, _cap: ContextMenuCapabilities): ContextMenuSection[] {
  void _request; void _cap
  return [
    {
      items: [
        { action: 'cut', label: '剪切', shortcut: 'Ctrl+X', enabled: ALWAYS_ENABLED },
        { action: 'copy', label: '复制', shortcut: 'Ctrl+C', enabled: ALWAYS_ENABLED },
        { action: 'paste', label: '粘贴', shortcut: 'Ctrl+V', enabled: ALWAYS_ENABLED },
        { action: 'select-all', label: '全选', shortcut: 'Ctrl+A', enabled: ALWAYS_ENABLED },
      ],
    },
  ]
}
