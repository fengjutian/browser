import type { CSSProperties } from 'react'

export interface InputNumberProps {
  value?: number | null
  defaultValue?: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  addonAfter?: string
  onChange?: (value: number | null) => void
  className?: string
  style?: CSSProperties
  name?: string
}

export function InputNumber({ value, defaultValue, min, max, step, disabled, addonAfter, onChange, className = '', style, name }: InputNumberProps) {
  return <span className={`ui-input-number ${disabled ? 'is-disabled' : ''} ${className}`.trim()} style={style}>
    <input type="number" name={name} value={value ?? ''} defaultValue={defaultValue} min={min} max={max} step={step} disabled={disabled} onChange={event => onChange?.(event.target.value === '' ? null : event.target.valueAsNumber)}/>
    {addonAfter && <span className="ui-input-number__addon">{addonAfter}</span>}
  </span>
}
