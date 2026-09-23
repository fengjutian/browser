import { Select as BaseSelect } from '@base-ui/react/select'
import { Check, ChevronDown } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useState } from 'react'
import { useModalOverlayLifecycle } from './overlayLifecycle'

export interface SelectOption<Value = string> {
  label: ReactNode
  value: Value
  disabled?: boolean
}

export interface SelectProps<Value = string, Option extends SelectOption<Value> = SelectOption<Value>> {
  value?: Value | Value[] | null
  defaultValue?: Value | Value[]
  options?: Option[]
  onChange?: (value: any, option?: Option | Option[]) => void
  mode?: 'multiple'
  placeholder?: ReactNode
  disabled?: boolean
  allowClear?: boolean
  maxTagCount?: number | 'responsive'
  size?: 'small' | 'middle' | 'large'
  className?: string
  style?: CSSProperties
  name?: string
  id?: string
}

export function Select<Value = string, Option extends SelectOption<Value> = SelectOption<Value>>({ value, defaultValue, options = [], onChange, mode, placeholder = '请选择', disabled, size = 'middle', className = '', style, name, id }: SelectProps<Value, Option>) {
  const [open, setOpen] = useState(false)
  const multiple = mode === 'multiple'
  useModalOverlayLifecycle(open)

  const change = (next: Value | Value[] | null) => {
    const selected = multiple
      ? options.filter(option => (next as Value[]).includes(option.value))
      : options.find(option => Object.is(option.value, next))
    onChange?.(next, selected as Option | Option[] | undefined)
  }

  return <BaseSelect.Root
    multiple={multiple as true}
    value={value as Value[]}
    defaultValue={defaultValue as Value[]}
    onValueChange={change as (next: Value[]) => void}
    items={options}
    disabled={disabled}
    name={name}
    id={id}
    open={open}
    onOpenChange={setOpen}
  >
    <BaseSelect.Trigger className={`ui-select ui-select--${size} ${className}`.trim()} style={style}>
      <BaseSelect.Value placeholder={placeholder}>
        {(selected: Value | Value[] | null) => {
          if (multiple) {
            const values = Array.isArray(selected) ? selected : []
            if (!values.length) return placeholder
            return <span className="ui-select__tags">{values.map(item => <span className="ui-select__tag" key={String(item)}>{options.find(option => Object.is(option.value, item))?.label ?? String(item)}</span>)}</span>
          }
          return options.find(option => Object.is(option.value, selected))?.label ?? (selected == null ? placeholder : String(selected))
        }}
      </BaseSelect.Value>
      <BaseSelect.Icon className="ui-select__icon"><ChevronDown size={15}/></BaseSelect.Icon>
    </BaseSelect.Trigger>
    <BaseSelect.Portal>
      <BaseSelect.Positioner className="ui-select__positioner" sideOffset={5}>
        <BaseSelect.Popup className="ui-select__popup">
          <BaseSelect.List>
            {options.map(option => <BaseSelect.Item className="ui-select__item" key={String(option.value)} value={option.value} disabled={option.disabled}>
              <BaseSelect.ItemIndicator className="ui-select__check"><Check size={14}/></BaseSelect.ItemIndicator>
              <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
            </BaseSelect.Item>)}
          </BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  </BaseSelect.Root>
}
