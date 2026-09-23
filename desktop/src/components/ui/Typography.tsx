import { Check, Copy } from 'lucide-react'
import { useState, type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode } from 'react'

type TextType = 'secondary' | 'success' | 'warning' | 'danger'
interface CommonProps extends HTMLAttributes<HTMLElement> {
  type?: TextType
  strong?: boolean
  code?: boolean
  ellipsis?: boolean | { rows?: number; tooltip?: ReactNode; expandable?: boolean }
  copyable?: boolean | { text?: string }
  children?: ReactNode
}

function classes(base: string, props: CommonProps): string {
  return `ant-typography ${base}${props.type ? ` ${base}--${props.type}` : ''}${props.strong ? ` ${base}--strong` : ''}${props.code ? ` ${base}--code` : ''} ${props.className ?? ''}`.trim()
}

function ellipsisStyle(ellipsis: CommonProps['ellipsis']): CSSProperties | undefined {
  if (!ellipsis) return undefined
  if (typeof ellipsis === 'object' && (ellipsis.rows ?? 1) > 1) return { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: ellipsis.rows ?? 1, overflow: 'hidden' }
  return { display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }
}

function Text({ type, strong, code, ellipsis, copyable, children, className, style, title, ...props }: CommonProps) {
  const [copied, setCopied] = useState(false)
  const copyText = typeof copyable === 'object' ? copyable.text : undefined
  const tooltip = typeof ellipsis === 'object' ? ellipsis.tooltip : undefined
  return <span {...props} className={classes('ui-typography-text', { type, strong, code, className })} style={{ ...ellipsisStyle(ellipsis), ...style }} title={title ?? (typeof tooltip === 'string' ? tooltip : undefined)}>
    {children}
    {copyable && <button type="button" className="ui-typography-copy" aria-label="复制" onClick={async () => { await navigator.clipboard.writeText(copyText ?? String(children ?? '')); setCopied(true); window.setTimeout(() => setCopied(false), 1200) }}>{copied ? <Check size={13}/> : <Copy size={13}/>}</button>}
  </span>
}

function Paragraph({ type, strong, code, ellipsis, children, className, style, ...props }: CommonProps) {
  return <p {...props} className={classes('ui-typography-paragraph', { type, strong, code, className })} style={{ ...ellipsisStyle(ellipsis), ...style }}>{children}</p>
}

interface TitleProps extends CommonProps { level?: 1 | 2 | 3 | 4 | 5 }
function Title({ level = 1, type, strong, code, ellipsis, children, className, style, ...props }: TitleProps) {
  const Tag: ElementType = `h${level}`
  return <Tag {...props} className={classes(`ui-typography-title ui-typography-title--${level}`, { type, strong, code, className })} style={{ ...ellipsisStyle(ellipsis), ...style }}>{children}</Tag>
}

export const Typography = { Text, Paragraph, Title }
