import { AlertDialog } from '@base-ui/react/alert-dialog'
import type { ReactElement, ReactNode } from 'react'
import { useState } from 'react'
import { Button, type ButtonProps } from './Button'
import { useModalOverlayLifecycle } from './overlayLifecycle'

export interface PopconfirmProps {
  children: ReactElement
  title: ReactNode
  description?: ReactNode
  okText?: ReactNode
  cancelText?: ReactNode
  okButtonProps?: ButtonProps
  disabled?: boolean
  onConfirm?: () => void | Promise<void>
  onCancel?: () => void
}

export function Popconfirm({ children, title, description, okText = '确定', cancelText = '取消', okButtonProps, disabled, onConfirm, onCancel }: PopconfirmProps) {
  const [open, setOpen] = useState(false)
  useModalOverlayLifecycle(open)
  if (disabled) return children
  return <AlertDialog.Root open={open} onOpenChange={setOpen}>
    <AlertDialog.Trigger render={children}/>
    <AlertDialog.Portal>
      <AlertDialog.Backdrop className="ui-dialog__backdrop"/>
      <AlertDialog.Viewport className="ui-dialog__viewport">
        <AlertDialog.Popup className="ui-confirm">
          <AlertDialog.Title className="ui-confirm__title">{title}</AlertDialog.Title>
          {description && <AlertDialog.Description className="ui-confirm__description">{description}</AlertDialog.Description>}
          <div className="ui-confirm__footer">
            <AlertDialog.Close render={<Button onClick={onCancel}/>}>{cancelText}</AlertDialog.Close>
            <AlertDialog.Close render={<Button type="primary" {...okButtonProps} onClick={() => void onConfirm?.()}/>}>{okText}</AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Viewport>
    </AlertDialog.Portal>
  </AlertDialog.Root>
}
