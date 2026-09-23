import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import type { ReactElement, ReactNode } from 'react'
import { splitPlacement, type Placement } from './floating'

export interface TooltipProps {
  title?: ReactNode
  children: ReactElement
  placement?: Placement
  mouseEnterDelay?: number
  mouseLeaveDelay?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function Tooltip({ title, children, placement = 'top', mouseEnterDelay = .6, mouseLeaveDelay = 0, open, onOpenChange }: TooltipProps) {
  if (title == null || title === '') return children
  const { side, align } = splitPlacement(placement)
  return <BaseTooltip.Provider>
    <BaseTooltip.Root open={open} onOpenChange={value => onOpenChange?.(value)}>
      <BaseTooltip.Trigger render={<span className="ui-floating-trigger"/>} delay={mouseEnterDelay * 1000} closeDelay={mouseLeaveDelay * 1000}>{children}</BaseTooltip.Trigger>
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} align={align} sideOffset={7} className="ui-tooltip__positioner">
          <BaseTooltip.Popup className="ui-tooltip" role="tooltip">{title}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  </BaseTooltip.Provider>
}
