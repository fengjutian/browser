import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  type?: 'default' | 'primary' | 'text' | 'link'
  htmlType?: ButtonHTMLAttributes<HTMLButtonElement>['type']
  icon?: ReactNode
  loading?: boolean
  danger?: boolean
  ghost?: boolean
  block?: boolean
  shape?: 'default' | 'circle' | 'round'
  size?: 'small' | 'middle' | 'large'
  href?: string
  target?: string
  download?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  type = 'default', htmlType = 'button', icon, loading = false, danger = false,
  ghost = false, block = false, shape = 'default', size = 'middle', className = '',
  children, disabled, href, target, download, ...props
}, ref) {
  const classes = [
    'ui-button', 'ant-btn', `ant-btn-${type}`, `ant-btn-${size}`, `ui-button--${type}`, `ui-button--${size}`,
    danger && 'is-danger', ghost && 'is-ghost', block && 'is-block',
    danger && 'ant-btn-dangerous', ghost && 'ant-btn-background-ghost', block && 'ant-btn-block',
    loading && 'ant-btn-loading',
    shape !== 'default' && `ui-button--${shape}`, className,
  ].filter(Boolean).join(' ')
  const content = <>{loading && <span className="ui-button__spinner" aria-hidden="true"/>}{!loading && icon && <span className="ui-button__icon">{icon}</span>}{children && <span className="ui-button__label">{children}</span>}</>

  if (href) {
    return <a className={classes} href={href} target={target} download={download} aria-disabled={disabled || loading} {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{content}</a>
  }
  return <button ref={ref} className={classes} type={htmlType} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>{content}</button>
})
