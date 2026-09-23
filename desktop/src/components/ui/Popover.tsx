import { Popover as BasePopover } from '@base-ui/react/popover'
import type { ReactElement, ReactNode } from 'react'
import { splitPlacement, type Placement } from './floating'

export interface PopoverProps {
  content: ReactNode
  children: ReactElement
  title?: ReactNode
  trigger?: 'click' | 'hover'
  placement?: Placement
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export function Popover({ content, children, title, trigger = 'click', placement = 'top', open, defaultOpen, onOpenChange }: PopoverProps) {
  const { side, align } = splitPlacement(placement)
  return <BasePopover.Root open={open} defaultOpen={defaultOpen} onOpenChange={value => onOpenChange?.(value)}>
    <BasePopover.Trigger render={<span className="ui-floating-trigger"/>} openOnHover={trigger === 'hover'}>{children}</BasePopover.Trigger>
    <BasePopover.Portal>
      <BasePopover.Positioner side={side} align={align} sideOffset={7} className="ui-popover__positioner">
        <BasePopover.Popup className="ui-popover">
          {title && <div className="ui-popover__title">{title}</div>}
          <div className="ui-popover__content">{content}</div>
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  </BasePopover.Root>
}
