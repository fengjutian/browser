import type { CSSProperties, ReactNode } from 'react'

export interface DescriptionItem {
  key?: string | number
  label?: ReactNode
  children?: ReactNode
  span?: number
}

export interface DescriptionsProps {
  items?: DescriptionItem[]
  title?: ReactNode
  extra?: ReactNode
  column?: number
  bordered?: boolean
  size?: 'small' | 'middle' | 'default'
  className?: string
  style?: CSSProperties
}

export function Descriptions({ items = [], title, extra, column = 3, bordered, size = 'default', className = '', style }: DescriptionsProps) {
  return <div className={`ui-descriptions ui-descriptions--${size}${bordered ? ' ui-descriptions--bordered' : ''} ${className}`.trim()} style={style}>
    {(title != null || extra != null) && <div className="ui-descriptions__header"><strong>{title}</strong><span>{extra}</span></div>}
    <dl className="ui-descriptions__grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, column)}, minmax(0, 1fr))` }}>
      {items.map((item, index) => <div className="ui-descriptions__item" key={item.key ?? index} style={{ gridColumn: `span ${Math.min(column, item.span ?? 1)}` }}><dt>{item.label}</dt><dd>{item.children}</dd></div>)}
    </dl>
  </div>
}
