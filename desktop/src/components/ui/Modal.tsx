import { Dialog } from '@base-ui/react/dialog'
import type { CSSProperties, ReactNode } from 'react'
import { Button, type ButtonProps } from './Button'
import { useModalOverlayLifecycle } from './overlayLifecycle'

export interface ModalProps {
  open?: boolean
  title?: ReactNode
  children?: ReactNode
  footer?: ReactNode | null
  width?: number | string
  closable?: boolean
  mask?: { closable?: boolean }
  onCancel?: () => void
  onOk?: () => void | Promise<void>
  okText?: ReactNode
  cancelText?: ReactNode
  okButtonProps?: ButtonProps
  cancelButtonProps?: ButtonProps
  destroyOnHidden?: boolean
  className?: string
  styles?: { body?: CSSProperties }
}

export function Modal({ open = false, title, children, footer, width = 520, closable = true, mask, onCancel, onOk, okText = '确定', cancelText = '取消', okButtonProps, cancelButtonProps, destroyOnHidden = true, className = '', styles }: ModalProps) {
  useModalOverlayLifecycle(open)
  return <Dialog.Root open={open} onOpenChange={(next, details) => {
    if (!next && mask?.closable === false && String(details.reason).includes('outside')) return
    if (!next) onCancel?.()
  }}>
    <Dialog.Portal keepMounted={!destroyOnHidden}>
      <Dialog.Backdrop className="ui-dialog__backdrop"/>
      <Dialog.Viewport className="ui-dialog__viewport">
        <Dialog.Popup className={`ui-dialog ${className}`.trim()} style={{ width }}>
          {(title != null || closable) && <header className="ui-dialog__header">
            {title != null ? <Dialog.Title className="ui-dialog__title">{title}</Dialog.Title> : <span/>}
            {closable && <Dialog.Close className="ui-dialog__close" aria-label="关闭">×</Dialog.Close>}
          </header>}
          <div className="ui-dialog__body" style={styles?.body}>{children}</div>
          {footer !== null && <footer className="ui-dialog__footer">{footer ?? <><Button {...cancelButtonProps} onClick={onCancel}>{cancelText}</Button><Button type="primary" {...okButtonProps} onClick={() => void onOk?.()}>{okText}</Button></>}</footer>}
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>
}
