import { Dialog } from '@base-ui/react/dialog'
import type { ReactNode } from 'react'
import { useModalOverlayLifecycle } from './overlayLifecycle'

export interface DrawerProps {
  open?: boolean
  title?: ReactNode
  extra?: ReactNode
  children?: ReactNode
  width?: number | string
  placement?: 'left' | 'right'
  closable?: boolean
  onClose?: () => void
  destroyOnHidden?: boolean
  className?: string
}

export function Drawer({ open = false, title, extra, children, width = 420, placement = 'right', closable = true, onClose, destroyOnHidden = true, className = '' }: DrawerProps) {
  useModalOverlayLifecycle(open)
  return <Dialog.Root open={open} onOpenChange={next => { if (!next) onClose?.() }}>
    <Dialog.Portal keepMounted={!destroyOnHidden}>
      <Dialog.Backdrop className="ui-dialog__backdrop"/>
      <Dialog.Viewport className={`ui-drawer__viewport ui-drawer__viewport--${placement}`}>
        <Dialog.Popup className={`ui-drawer ui-drawer--${placement} ${className}`.trim()} style={{ width }}>
          <header className="ui-drawer__header"><Dialog.Title className="ui-drawer__title">{title}</Dialog.Title>{extra}<span className="ui-drawer__spacer"/>{closable && <Dialog.Close className="ui-dialog__close" aria-label="关闭">×</Dialog.Close>}</header>
          <div className="ui-drawer__body">{children}</div>
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>
}
