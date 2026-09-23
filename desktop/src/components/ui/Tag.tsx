import type { HTMLAttributes, ReactNode } from 'react'

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  color?: string
  icon?: ReactNode
  closable?: boolean
  onClose?: () => void
}

export function Tag({ color = 'default', icon, closable, onClose, className = '', children, ...props }: TagProps) {
  const preset = /^[a-z-]+$/i.test(color) ? color.toLowerCase() : 'custom'
  const style = preset === 'custom' ? { ...props.style, '--ui-tag-color': color } as React.CSSProperties : props.style
  return <span className={`ui-tag ant-tag ui-tag--${preset} ${className}`.trim()} {...props} style={style}>
    {icon && <span className="ui-tag__icon">{icon}</span>}
    <span>{children}</span>
    {closable && <button type="button" className="ui-tag__close" aria-label="移除" onClick={event => { event.stopPropagation(); onClose?.() }}>×</button>}
  </span>
}
