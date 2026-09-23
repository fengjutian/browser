import { Children, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'

type SpaceSize = number | 'small' | 'middle' | 'large'
export interface SpaceProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical'
  direction?: 'horizontal' | 'vertical'
  size?: SpaceSize
  align?: CSSProperties['alignItems'] | 'start' | 'end'
  wrap?: boolean
}

const gapValue = (size: SpaceSize | undefined) => typeof size === 'number' ? size : size === 'large' ? 16 : size === 'small' ? 4 : 8

export function Space({ orientation, direction, size, align, wrap, className = '', style, children, ...props }: SpaceProps) {
  const axis = orientation ?? direction ?? 'horizontal'
  return <div className={`ui-space ant-space ant-space-${axis} ui-space--${axis} ${wrap ? 'is-wrap ant-space-wrap' : ''} ${className}`.trim()} style={{ gap: gapValue(size), alignItems: align, ...style }} {...props}>
    {Children.toArray(children).map((child, index) => <div className="ui-space__item ant-space-item" key={index}>{child}</div>)}
  </div>
}

function Compact({ block, className = '', children, ...props }: HTMLAttributes<HTMLDivElement> & { block?: boolean; children?: ReactNode }) {
  return <div className={`ui-space-compact ant-space-compact ${block ? 'is-block ant-space-compact-block' : ''} ${className}`.trim()} {...props}>{children}</div>
}

Space.Compact = Compact
