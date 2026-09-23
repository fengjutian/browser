import { ContextMenu } from '@base-ui/react/context-menu'
import { Menu } from '@base-ui/react/menu'
import type { ReactElement, ReactNode } from 'react'
import { splitPlacement, type Placement } from './floating'

export type MenuItem = { key?: string; label?: ReactNode; icon?: ReactNode; disabled?: boolean; danger?: boolean; onClick?: () => void; type?: 'divider' }
export interface MenuProps { items?: Array<MenuItem | null> }
export interface DropdownProps {
  children: ReactElement
  menu: MenuProps
  trigger?: Array<'click' | 'contextMenu'>
  placement?: Placement
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function MenuRows({ items }: { items?: Array<MenuItem | null> }) {
  return <>{items?.map((item, index) => !item ? null : item.type === 'divider'
    ? <Menu.Separator className="ui-dropdown__separator" key={item.key ?? `divider-${index}`}/>
    : <Menu.Item className={`ui-dropdown__item ${item.danger ? 'is-danger' : ''}`} key={item.key ?? index} disabled={item.disabled} onClick={() => item.onClick?.()}>
        {item.icon && <span className="ui-dropdown__icon">{item.icon}</span>}<span>{item.label}</span>
      </Menu.Item>)}</>
}

function ContextRows({ items }: { items?: Array<MenuItem | null> }) {
  return <>{items?.map((item, index) => !item ? null : item.type === 'divider'
    ? <ContextMenu.Separator className="ui-dropdown__separator" key={item.key ?? `divider-${index}`}/>
    : <ContextMenu.Item className={`ui-dropdown__item ${item.danger ? 'is-danger' : ''}`} key={item.key ?? index} disabled={item.disabled} onClick={() => item.onClick?.()}>
        {item.icon && <span className="ui-dropdown__icon">{item.icon}</span>}<span>{item.label}</span>
      </ContextMenu.Item>)}</>
}

export function Dropdown({ children, menu, trigger = ['click'], placement = 'bottomLeft', open, onOpenChange }: DropdownProps) {
  if (trigger.includes('contextMenu')) {
    return <ContextMenu.Root onOpenChange={value => onOpenChange?.(value)}>
      <ContextMenu.Trigger render={<span className="ui-floating-trigger"/>}>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal><ContextMenu.Positioner className="ui-dropdown__positioner"><ContextMenu.Popup className="ui-dropdown"><ContextRows items={menu.items}/></ContextMenu.Popup></ContextMenu.Positioner></ContextMenu.Portal>
    </ContextMenu.Root>
  }
  const { side, align } = splitPlacement(placement)
  return <Menu.Root open={open} onOpenChange={value => onOpenChange?.(value)}>
    <Menu.Trigger render={<span className="ui-floating-trigger"/>}>{children}</Menu.Trigger>
    <Menu.Portal><Menu.Positioner side={side} align={align} sideOffset={6} className="ui-dropdown__positioner"><Menu.Popup className="ui-dropdown"><MenuRows items={menu.items}/></Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>
}
