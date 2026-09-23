import type { CSSProperties, ReactNode } from 'react'

export interface SegmentedOption<Value extends string | number = string> {
  label?: ReactNode
  value: Value
  disabled?: boolean
}

export interface SegmentedProps<Value extends string | number = string> {
  value?: Value
  defaultValue?: Value
  options: Array<SegmentedOption<Value> | Value>
  onChange?: (value: Value) => void
  block?: boolean
  disabled?: boolean
  size?: 'small' | 'middle' | 'large'
  className?: string
  style?: CSSProperties
}

export function Segmented<Value extends string | number = string>({ value, defaultValue, options, onChange, block, disabled, size = 'middle', className = '', style }: SegmentedProps<Value>) {
  const selected = value ?? defaultValue
  return <div className={`ui-segmented ui-segmented--${size}${block ? ' ui-segmented--block' : ''} ${className}`.trim()} style={style} role="radiogroup">
    {options.map(raw => {
      const option = typeof raw === 'object' ? raw : { label: String(raw), value: raw }
      const active = option.value === selected
      return <button key={String(option.value)} type="button" role="radio" aria-checked={active} disabled={disabled || option.disabled} className={active ? 'is-active' : ''} onClick={() => onChange?.(option.value)}>
        {option.label ?? String(option.value)}
      </button>
    })}
  </div>
}
