import { useEffect, useMemo, useState, type CSSProperties, type Key, type ReactNode } from 'react'
import { Empty } from './Empty'
import { Spin } from './Spin'

export interface TableColumn<RecordType> {
  title?: ReactNode
  dataIndex?: keyof RecordType | string
  key?: Key
  width?: number | string
  ellipsis?: boolean
  align?: 'left' | 'center' | 'right'
  render?: (value: any, record: RecordType, index: number) => ReactNode
}

export interface TableProps<RecordType> {
  columns?: TableColumn<RecordType>[]
  dataSource?: RecordType[]
  rowKey?: keyof RecordType | ((record: RecordType) => Key)
  rowClassName?: string | ((record: RecordType, index: number) => string)
  loading?: boolean
  pagination?: false | { pageSize?: number; showSizeChanger?: boolean }
  size?: 'small' | 'middle' | 'large'
  className?: string
  style?: CSSProperties
}

function valueAt<RecordType>(record: RecordType, dataIndex?: keyof RecordType | string): any {
  if (dataIndex == null) return undefined
  return String(dataIndex).split('.').reduce<any>((value, key) => value?.[key], record)
}

export function Table<RecordType>({ columns = [], dataSource = [], rowKey, rowClassName, loading, pagination, size = 'middle', className = '', style }: TableProps<RecordType>) {
  const [page, setPage] = useState(1)
  const pageSize = pagination === false ? dataSource.length || 1 : pagination?.pageSize ?? 10
  const pages = Math.max(1, Math.ceil(dataSource.length / pageSize))
  useEffect(() => setPage(current => Math.min(current, pages)), [pages])
  const rows = useMemo(() => pagination === false ? dataSource : dataSource.slice((page - 1) * pageSize, page * pageSize), [dataSource, page, pageSize, pagination])
  const keyOf = (record: RecordType, index: number): Key => typeof rowKey === 'function' ? rowKey(record) : rowKey ? String((record as any)[rowKey]) : index

  return <div className={`ui-table ui-table--${size} ${className}`.trim()} style={style}>
    <div className="ui-table__scroll">
      <table>
        <thead><tr>{columns.map((column, index) => <th key={column.key ?? String(column.dataIndex ?? index)} style={{ width: column.width, textAlign: column.align }}>{column.title}</th>)}</tr></thead>
        <tbody>{rows.map((record, rowIndex) => {
          const absoluteIndex = (page - 1) * pageSize + rowIndex
          const rowClass = typeof rowClassName === 'function' ? rowClassName(record, absoluteIndex) : rowClassName
          return <tr key={keyOf(record, absoluteIndex)} className={rowClass}>{columns.map((column, columnIndex) => {
            const value = valueAt(record, column.dataIndex)
            return <td key={column.key ?? String(column.dataIndex ?? columnIndex)} className={column.ellipsis ? 'is-ellipsis' : undefined} style={{ width: column.width, textAlign: column.align }}>{column.render ? column.render(value, record, absoluteIndex) : value as ReactNode}</td>
          })}</tr>
        })}</tbody>
      </table>
      {loading && <div className="ui-table__loading"><Spin/></div>}
      {!loading && dataSource.length === 0 && <Empty/>}
    </div>
    {pagination !== false && pages > 1 && <div className="ui-table__pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><span>{page} / {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>下一页</button></div>}
  </div>
}
