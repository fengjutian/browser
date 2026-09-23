import { Inbox } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

export interface EmptyProps {
  image?: ReactNode
  description?: ReactNode
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

const simpleImage = <Inbox size={32}/>

function EmptyView({ image = simpleImage, description = '暂无数据', children, className = '', style }: EmptyProps) {
  return <div className={`ui-empty ${className}`.trim()} style={style}>
    {image !== null && <div className="ui-empty__image">{image}</div>}
    {description !== null && <div className="ui-empty__description">{description}</div>}
    {children && <div className="ui-empty__footer">{children}</div>}
  </div>
}

export const Empty = Object.assign(EmptyView, { PRESENTED_IMAGE_SIMPLE: simpleImage })
