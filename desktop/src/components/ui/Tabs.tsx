import { useEffect, useState, type CSSProperties, type Key, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'

export interface TabItem { key: string; label?: ReactNode; children?: ReactNode; closable?: boolean; className?: string; disabled?: boolean }
export interface TabsProps { items?: TabItem[]; activeKey?: string; defaultActiveKey?: string; onChange?: (key: string) => void; onEdit?: (targetKey: Key | MouseEvent, action: 'add' | 'remove') => void; type?: 'line' | 'card' | 'editable-card'; tabPosition?: 'top' | 'left'; addIcon?: ReactNode; destroyOnHidden?: boolean; className?: string; style?: CSSProperties }

export function Tabs({ items = [], activeKey, defaultActiveKey, onChange, onEdit, type = 'line', tabPosition = 'top', addIcon, destroyOnHidden, className = '', style }: TabsProps) {
  const [inner, setInner] = useState(defaultActiveKey ?? items[0]?.key ?? '')
  const selected = activeKey ?? inner
  useEffect(() => { if (!items.some(item => item.key === selected) && items[0]) setInner(items[0].key) }, [items, selected])
  const select = (key: string) => { if (activeKey == null) setInner(key); onChange?.(key) }
  const add = (event: ReactMouseEvent<HTMLButtonElement>) => onEdit?.(event.nativeEvent, 'add')
  return <div className={`ant-tabs ant-tabs-${tabPosition} ant-tabs-${type} ui-tabs ui-tabs--${tabPosition} ${className}`.trim()} style={style}>
    <div className="ant-tabs-nav ui-tabs__nav"><div className="ant-tabs-nav-wrap"><div className="ant-tabs-nav-list">{items.map(item => <div key={item.key} className={`ant-tabs-tab${item.key === selected ? ' ant-tabs-tab-active' : ''} ${item.className ?? ''}`.trim()}><button type="button" className="ant-tabs-tab-btn" disabled={item.disabled} onClick={() => select(item.key)}>{item.label}</button>{type === 'editable-card' && item.closable !== false && <button type="button" className="ui-tabs__close" aria-label="关闭标签页" onClick={event => { event.stopPropagation(); onEdit?.(item.key, 'remove') }}>×</button>}</div>)}</div></div>{type === 'editable-card' && <button type="button" className="ant-tabs-nav-add ui-tabs__add" onClick={add}>{addIcon ?? '+'}</button>}</div>
    <div className="ant-tabs-content-holder ui-tabs__content"><div className="ant-tabs-content">{items.map(item => destroyOnHidden === false ? <div key={item.key} className={`ant-tabs-tabpane${item.key === selected ? ' ant-tabs-tabpane-active' : ''}`} hidden={item.key !== selected}>{item.children}</div> : item.key === selected ? <div key={item.key} className="ant-tabs-tabpane ant-tabs-tabpane-active">{item.children}</div> : null)}</div></div>
  </div>
}
