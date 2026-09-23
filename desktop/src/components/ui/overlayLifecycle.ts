import { useEffect } from 'react'

export const UI_MODAL_OVERLAY_EVENT = 'arcadia-ui-modal-overlay-change'

export function useModalOverlayLifecycle(open: boolean): void {
  useEffect(() => {
    if (!open) return undefined
    window.dispatchEvent(new CustomEvent<number>(UI_MODAL_OVERLAY_EVENT, { detail: 1 }))
    return () => {
      window.dispatchEvent(new CustomEvent<number>(UI_MODAL_OVERLAY_EVENT, { detail: -1 }))
    }
  }, [open])
}
