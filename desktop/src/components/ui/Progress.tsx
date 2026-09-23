import type { CSSProperties, ReactNode } from 'react'

export interface ProgressProps {
  percent?: number
  status?: 'normal' | 'active' | 'success' | 'exception'
  format?: (percent?: number) => ReactNode
  showInfo?: boolean
  size?: 'small' | 'default' | number
  className?: string
  style?: CSSProperties
}

export function Progress({ percent = 0, status = 'normal', format, showInfo = true, size = 'default', className = '', style }: ProgressProps) {
  const value = Math.max(0, Math.min(100, percent))
  const text = format ? format(percent) : `${Math.round(value)}%`
  const height = typeof size === 'number' ? size : size === 'small' ? 6 : 8
  return <div className={`ui-progress ui-progress--${status} ${className}`.trim()} style={style}>
    <div className="ui-progress__rail" style={{ height }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <div className="ui-progress__bar" style={{ width: `${value}%` }}/>
    </div>
    {showInfo && <span className="ui-progress__text">{text}</span>}
  </div>
}
