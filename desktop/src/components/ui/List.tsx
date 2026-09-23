import { Children, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { Empty } from './Empty'
import { Spin } from './Spin'

export interface ListProps<Item> {
  dataSource?: Item[]
  renderItem?: (item: Item, index: number) => ReactNode
  loading?: boolean
  size?: 'small' | 'default' | 'large'
  itemLayout?: 'horizontal' | 'vertical'
  locale?: { emptyText?: ReactNode }
  className?: string
  style?: CSSProperties
}

export interface ListItemProps extends HTMLAttributes<HTMLDivElement> {
  actions?: ReactNode[]
  extra?: ReactNode
}

export interface ListItemMetaProps {
  avatar?: ReactNode
  title?: ReactNode
  description?: ReactNode
  className?: string
}

function ListItem({ actions, extra, children, className = '', ...props }: ListItemProps) {
  return <div className={`ui-list-item ${className}`.trim()} {...props}>
    <div className="ui-list-item__content">{children}</div>
    {actions?.length ? <div className="ui-list-item__actions">{actions.map((action, index) => <span key={index}>{action}</span>)}</div> : null}
    {extra != null && <div className="ui-list-item__extra">{extra}</div>}
  </div>
}

function ListItemMeta({ avatar, title, description, className = '' }: ListItemMetaProps) {
  return <div className={`ui-list-meta ${className}`.trim()}>
    {avatar != null && <div className="ui-list-meta__avatar">{avatar}</div>}
    <div className="ui-list-meta__content">
      {title != null && <div className="ui-list-meta__title">{title}</div>}
      {description != null && <div className="ui-list-meta__description">{description}</div>}
    </div>
  </div>
}

ListItem.Meta = ListItemMeta

function ListView<Item>({ dataSource = [], renderItem, loading, size = 'default', itemLayout = 'horizontal', locale, className = '', style }: ListProps<Item>) {
  return <div className={`ui-list ui-list--${size} ui-list--${itemLayout} ${className}`.trim()} style={style}>
    {loading && <div className="ui-list__loading"><Spin size="small"/></div>}
    {!loading && dataSource.length === 0 ? (locale?.emptyText ?? <Empty/>) : dataSource.map((item, index) => <div className="ui-list__row" key={index}>{renderItem?.(item, index)}</div>)}
  </div>
}

export const List = Object.assign(ListView, { Item: ListItem }) as typeof ListView & {
  Item: typeof ListItem & { Meta: typeof ListItemMeta }
}
