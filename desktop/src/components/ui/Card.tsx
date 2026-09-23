import type { HTMLAttributes, ReactNode } from 'react'

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode
  extra?: ReactNode
  cover?: ReactNode
  actions?: ReactNode[]
  hoverable?: boolean
  size?: 'default' | 'small'
}

export function Card({ title, extra, cover, actions, hoverable, size = 'default', className = '', children, ...props }: CardProps) {
  return <div className={`ui-card ant-card ant-card-${size} ui-card--${size} ${hoverable ? 'is-hoverable ant-card-hoverable' : ''} ${className}`.trim()} {...props}>
    {cover && <div className="ui-card__cover ant-card-cover">{cover}</div>}
    {(title || extra) && <div className="ui-card__head ant-card-head"><div className="ui-card__title ant-card-head-title">{title}</div>{extra && <div className="ui-card__extra ant-card-extra">{extra}</div>}</div>}
    <div className="ui-card__body ant-card-body">{children}</div>
    {actions?.length ? <ul className="ui-card__actions ant-card-actions">{actions.map((action, index) => <li key={index}>{action}</li>)}</ul> : null}
  </div>
}
