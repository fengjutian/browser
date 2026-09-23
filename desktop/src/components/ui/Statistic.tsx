import type { CSSProperties, ReactNode } from 'react'

export interface StatisticProps {
  title?: ReactNode
  value?: ReactNode
  prefix?: ReactNode
  suffix?: ReactNode
  valueStyle?: CSSProperties
  className?: string
  style?: CSSProperties
}

export function Statistic({ title, value, prefix, suffix, valueStyle, className = '', style }: StatisticProps) {
  return <div className={`ui-statistic ${className}`.trim()} style={style}>
    {title != null && <div className="ui-statistic__title">{title}</div>}
    <div className="ui-statistic__value" style={valueStyle}>{prefix}<span>{value}</span>{suffix != null && <span className="ui-statistic__suffix">{suffix}</span>}</div>
  </div>
}
