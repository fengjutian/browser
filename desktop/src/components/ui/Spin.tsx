import { LoaderCircle } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

export interface SpinProps {
  spinning?: boolean
  size?: 'small' | 'default' | 'large'
  tip?: ReactNode
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

export function Spin({ spinning = true, size = 'default', tip, children, className = '', style }: SpinProps) {
  if (children) return <div className={`ui-spin-container${spinning ? ' is-spinning' : ''} ${className}`.trim()} style={style}>{children}{spinning && <span className="ui-spin-container__overlay"><Spin size={size} tip={tip}/></span>}</div>
  if (!spinning) return null
  return <span className={`ui-spin ui-spin--${size} ${className}`.trim()} style={style} role="status" aria-label="加载中"><LoaderCircle/><span>{tip}</span></span>
}
