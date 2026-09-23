import { useEffect, useMemo, useRef, useState } from 'react'
import { Menu, type MenuComponentProps } from '../../components/ui'
import { onNativeContextMenu, type ContextMenuRequest } from '../../services/nativeBrowser'
import { buildContextMenu, type ContextMenuAction, type ContextMenuCapabilities } from './contextMenu'

export interface ContextMenuProps {
  /** Anchor element the menu is positioned relative to (e.g. the content surface). */
  surfaceRef: React.RefObject<HTMLElement | null>
  capabilities: ContextMenuCapabilities
  onAction: (action: ContextMenuAction, request: ContextMenuRequest) => void
  onDismiss?: () => void
}

interface MenuState {
  request: ContextMenuRequest
  /** Position in surface-local coordinates. */
  x: number
  y: number
}

const MENU_WIDTH = 240
const MENU_MAX_HEIGHT = 320

/**
 * Subscribes to `browser://context-menu` events emitted by the init script
 * injected into every child WebView, then renders an antd Menu anchored at
 * the cursor. Coordinates from the WebView are viewport-relative; we offset
 * them by the surface rect so the menu floats over the right pixel of the
 * main window even when the WebView is offset.
 */
export function ContextMenu({ surfaceRef, capabilities, onAction, onDismiss }: ContextMenuProps) {
  const [state, setState] = useState<MenuState | null>(null)

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void onNativeContextMenu(request => {
      if (disposed) return
      const surface = surfaceRef.current
      if (!surface) return
      const rect = surface.getBoundingClientRect()
      // The WebView's clientX/clientY is in its own viewport; on Windows the
      // Tauri sub-WebView reports its own origin, so we add the surface's
      // screen offset to land on the right main-window pixel.
      const x = request.clientX + rect.left
      const y = request.clientY + rect.top
      // Clamp inside the surface so the menu stays on-screen.
      const clampedX = Math.max(rect.left + 4, Math.min(rect.right - MENU_WIDTH - 4, x))
      const clampedY = Math.max(rect.top + 4, Math.min(rect.bottom - 80, y))
      setState({ request, x: clampedX, y: clampedY })
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [surfaceRef])

  // Dismiss on outside click, Esc, or tab switch.
  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(() => {
    if (!state) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setState(null)
        onDismiss?.()
      }
    }
    const onPointer = (event: PointerEvent) => {
      const menu = document.querySelector('.browser-context-menu')
      if (menu && event.target instanceof Node && menu.contains(event.target)) return
      setState(null)
      onDismiss?.()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer, true)
    }
  }, [state, onDismiss])

  const built = useMemo(() => (state ? buildContextMenu(state.request, capabilities) : null), [state, capabilities])

  if (!state || !built) return null

  const items: MenuComponentProps['items'] = built.sections.flatMap((section, sectionIndex) => {
    const flat: NonNullable<MenuComponentProps['items']> = section.items.map((item, itemIndex) => ({
      key: `${item.action}-${sectionIndex}-${itemIndex}`,
      label: (
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{item.label}</span>
          {item.shortcut && <span style={{ opacity: 0.6, fontSize: 12 }}>{item.shortcut}</span>}
        </span>
      ),
      disabled: !item.enabled,
      title: item.enabled ? undefined : item.disabledReason,
      onClick: () => {
        onAction(item.action, state.request)
        setState(null)
        onDismiss?.()
      },
    }))
    // Insert a divider between sections (not before the first section).
    if (sectionIndex > 0) flat.unshift({ type: 'divider', key: `div-${sectionIndex}` } as NonNullable<MenuComponentProps['items']>[number])
    return flat
  })

  return (
    <div
      className="browser-context-menu"
      role="menu"
      data-testid="browser-context-menu"
      style={{
        position: 'fixed',
        top: state.y,
        left: state.x,
        zIndex: 9999,
        width: MENU_WIDTH,
        maxHeight: MENU_MAX_HEIGHT,
        background: 'var(--ant-color-bg-elevated, #fff)',
        border: '1px solid var(--ant-color-border, #d9d9d9)',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        padding: 4,
        overflow: 'auto',
      }}
    >
      <Menu
        mode="vertical"
        items={items}
        style={{ border: 'none', background: 'transparent' }}
        onClick={() => setState(null)}
      />
    </div>
  )
}
