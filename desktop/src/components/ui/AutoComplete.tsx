import { Children, cloneElement, isValidElement, useEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { useModalOverlayLifecycle } from './overlayLifecycle'

export interface AutoCompleteOption {
  value: string
  label?: ReactNode
}

export interface AutoCompleteProps {
  value?: string
  options?: AutoCompleteOption[]
  onChange?: (value: string) => void
  onSelect?: (value: string, option: AutoCompleteOption) => void
  children: ReactElement<any>
  className?: string
}

export function AutoComplete({ value = '', options = [], onChange, onSelect, children, className = '' }: AutoCompleteProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const closeTimer = useRef<number | undefined>(undefined)
  useModalOverlayLifecycle(open)

  useEffect(() => setActiveIndex(-1), [options])
  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  const choose = (option: AutoCompleteOption) => {
    onChange?.(option.value)
    onSelect?.(option.value, option)
    setOpen(false)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    children.props.onKeyDown?.(event)
    if (!options.length) return
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex(index => Math.min(options.length - 1, index + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActiveIndex(index => Math.max(0, index - 1)) }
    else if (event.key === 'Escape') setOpen(false)
    else if (event.key === 'Enter' && open && activeIndex >= 0) { event.preventDefault(); choose(options[activeIndex]) }
  }

  const child = Children.only(children) as ReactElement<{ value?: string; onChange?: (event: any) => void; onFocus?: (event: any) => void; onBlur?: (event: any) => void; onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void }>
  if (!isValidElement(child)) return null
  return <div className={`ui-autocomplete ${className}`.trim()}>
    {cloneElement(child, {
      value,
      onChange: (event: any) => { child.props.onChange?.(event); onChange?.(event?.target?.value ?? String(event ?? '')); setOpen(true) },
      onFocus: (event: any) => { window.clearTimeout(closeTimer.current); child.props.onFocus?.(event); setOpen(options.length > 0) },
      onBlur: (event: any) => { child.props.onBlur?.(event); closeTimer.current = window.setTimeout(() => setOpen(false), 120) },
      onKeyDown,
      role: 'combobox',
      'aria-expanded': open,
      'aria-autocomplete': 'list',
    })}
    {open && options.length > 0 && <div className="ui-autocomplete__popup" role="listbox">
      {options.map((option, index) => <button key={`${option.value}-${index}`} type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? 'is-active' : ''} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>{option.label ?? option.value}</button>)}
    </div>}
  </div>
}
