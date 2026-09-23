import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked?: boolean
  defaultChecked?: boolean
  onChange?: (checked: boolean) => void
  checkedChildren?: ReactNode
  unCheckedChildren?: ReactNode
}

export function Switch({ checked, defaultChecked, onChange, checkedChildren, unCheckedChildren, className = '', disabled, ...props }: SwitchProps) {
  const active = checked ?? defaultChecked ?? false
  return <button type="button" role="switch" aria-checked={active} disabled={disabled} className={`ui-switch ant-switch ${active ? 'is-checked ant-switch-checked' : ''} ${className}`.trim()} onClick={() => onChange?.(!active)} {...props}>
    <span className="ui-switch__handle ant-switch-handle"/>
    {(checkedChildren || unCheckedChildren) && <span className="ui-switch__label ant-switch-inner">{active ? checkedChildren : unCheckedChildren}</span>}
  </button>
}
