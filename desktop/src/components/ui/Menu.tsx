import type { CSSProperties, ReactNode } from 'react'
export interface MenuEntry { key?: string; label?: ReactNode; icon?: ReactNode; disabled?: boolean; danger?: boolean; title?: string; type?: 'divider'; onClick?: () => void }
export interface MenuComponentProps { items?: MenuEntry[]; mode?: 'vertical' | 'horizontal'; style?: CSSProperties; className?: string; onClick?: () => void }
export function Menu({ items = [], mode = 'vertical', style, className = '', onClick }: MenuComponentProps) { return <div className={`ui-menu ui-menu--${mode} ${className}`.trim()} style={style} role="menu">{items.map((item, index) => item.type === 'divider' ? <div className="ui-menu__divider" key={item.key ?? index}/> : <button type="button" role="menuitem" key={item.key ?? index} disabled={item.disabled} title={item.title} className={item.danger ? 'is-danger' : ''} onClick={() => { item.onClick?.(); onClick?.() }}>{item.icon}{item.label}</button>)}</div> }
export type MenuProps = MenuComponentProps
