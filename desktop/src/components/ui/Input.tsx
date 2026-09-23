import { forwardRef, useImperativeHandle, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type TextareaHTMLAttributes } from 'react'

export interface InputRef {
  input: HTMLInputElement | null
  focus: (options?: { cursor?: 'start' | 'end' | 'all' }) => void
  blur: () => void
  select: () => void
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  size?: 'small' | 'middle' | 'large'
  prefix?: ReactNode
  suffix?: ReactNode
  allowClear?: boolean
  status?: 'error' | 'warning'
  onPressEnter?: (event: KeyboardEvent<HTMLInputElement>) => void
}

const BaseInput = forwardRef<InputRef, InputProps>(function Input({
  size = 'middle', prefix, suffix, allowClear, status, className = '',
  onPressEnter, onKeyDown, value, defaultValue, type = 'text', ...props
}, forwardedRef) {
  const inputRef = useRef<HTMLInputElement>(null)
  useImperativeHandle(forwardedRef, () => ({
    input: inputRef.current,
    focus(options) {
      inputRef.current?.focus()
      if (options?.cursor === 'all') inputRef.current?.select()
      else if (inputRef.current && options?.cursor) {
        const position = options.cursor === 'start' ? 0 : inputRef.current.value.length
        inputRef.current.setSelectionRange(position, position)
      }
    },
    blur: () => inputRef.current?.blur(),
    select: () => inputRef.current?.select(),
  }))

  const clear = () => {
    if (!inputRef.current || props.disabled) return
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(inputRef.current, '')
    inputRef.current.dispatchEvent(new Event('input', { bubbles: true }))
    inputRef.current.focus()
  }
  const hasValue = String(value ?? defaultValue ?? '').length > 0
  return <span className={`ui-input ant-input-affix-wrapper ui-input--${size} ${status ? `is-${status}` : ''} ${props.disabled ? 'is-disabled' : ''} ${className}`.trim()}>
    {prefix && <span className="ui-input__prefix ant-input-prefix">{prefix}</span>}
    <input ref={inputRef} className="ui-input__control ant-input" type={type} value={value} defaultValue={defaultValue} onKeyDown={event => { if (event.key === 'Enter') onPressEnter?.(event); onKeyDown?.(event) }} {...props}/>
    {allowClear && hasValue && <button type="button" className="ui-input__clear" aria-label="清空" onClick={clear}>×</button>}
    {suffix && <span className="ui-input__suffix ant-input-suffix">{suffix}</span>}
  </span>
})

function Password(props: InputProps & { visibilityToggle?: boolean }) {
  const [visible, setVisible] = useState(false)
  const { visibilityToggle = true, suffix, ...rest } = props
  return <BaseInput {...rest} type={visible ? 'text' : 'password'} suffix={<>{suffix}{visibilityToggle && <button type="button" className="ui-input__password-toggle" aria-label={visible ? '隐藏密码' : '显示密码'} onClick={() => setVisible(value => !value)}>{visible ? '隐藏' : '显示'}</button>}</>}/>
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoSize?: boolean | { minRows?: number; maxRows?: number }
}

function TextArea({ autoSize, className = '', rows, style, ...props }: TextAreaProps) {
  const minRows = typeof autoSize === 'object' ? autoSize.minRows : rows
  const maxRows = typeof autoSize === 'object' ? autoSize.maxRows : undefined
  return <textarea className={`ui-textarea ant-input ${className}`.trim()} rows={minRows} style={{ ...style, maxHeight: maxRows ? `${maxRows * 1.5}em` : undefined }} {...props}/>
}

export const Input = Object.assign(BaseInput, { Password, TextArea })
