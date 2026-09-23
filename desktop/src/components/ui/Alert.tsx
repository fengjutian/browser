import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { useState, type CSSProperties, type ReactNode } from 'react'

export interface AlertProps {
  type?: 'success' | 'info' | 'warning' | 'error'
  message?: ReactNode
  description?: ReactNode
  showIcon?: boolean
  icon?: ReactNode
  action?: ReactNode
  closable?: boolean
  banner?: boolean
  className?: string
  style?: CSSProperties
  onClose?: () => void
}

const icons = {
  success: <CheckCircle2 size={18}/>,
  info: <Info size={18}/>,
  warning: <TriangleAlert size={18}/>,
  error: <AlertCircle size={18}/>,
}

export function Alert({ type = 'info', message, description, showIcon, icon, action, closable, banner, className = '', style, onClose }: AlertProps) {
  const [visible, setVisible] = useState(true)
  if (!visible) return null
  return <div role={type === 'error' ? 'alert' : 'status'} className={`ui-alert ui-alert--${type}${banner ? ' ui-alert--banner' : ''} ${className}`.trim()} style={style}>
    {(showIcon || icon) && <span className="ui-alert__icon">{icon ?? icons[type]}</span>}
    <div className="ui-alert__content">
      {message != null && <div className="ui-alert__message">{message}</div>}
      {description != null && <div className="ui-alert__description">{description}</div>}
    </div>
    {action != null && <div className="ui-alert__action">{action}</div>}
    {closable && <button type="button" className="ui-alert__close" aria-label="关闭" onClick={() => { setVisible(false); onClose?.() }}><X size={15}/></button>}
  </div>
}
