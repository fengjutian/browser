import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useMemo, useSyncExternalStore, type FormEvent, type ReactElement, type ReactNode } from 'react'

export interface FormRule {
  required?: boolean
  type?: 'url' | 'number'
  min?: number
  max?: number
  message?: string
}

export interface FormInstance<Values extends Record<string, any> = Record<string, any>> {
  getFieldValue: (name: keyof Values | string) => any
  getFieldsValue: (names?: Array<keyof Values | string>) => Partial<Values>
  setFieldValue: (name: keyof Values | string, value: any) => void
  setFieldsValue: (values: Partial<Values>) => void
  resetFields: () => void
  validateFields: (names?: Array<keyof Values | string>) => Promise<Values>
  _subscribe: (listener: () => void) => () => void
  _snapshot: () => number
  _setInitial: (values: Partial<Values>) => void
  _register: (name: string, rules: FormRule[]) => () => void
}

function createForm<Values extends Record<string, any>>(): FormInstance<Values> {
  let values: Record<string, any> = {}
  let initial: Record<string, any> = {}
  let version = 0
  const listeners = new Set<() => void>()
  const rules = new Map<string, FormRule[]>()
  const notify = () => { version += 1; listeners.forEach(listener => listener()) }
  const validate = (names?: Array<keyof Values | string>) => {
    for (const name of (names?.map(String) ?? [...rules.keys()])) {
      const value = values[name]
      for (const rule of rules.get(name) ?? []) {
        const empty = value == null || String(value).trim() === ''
        if (rule.required && empty) throw new Error(rule.message ?? `请填写${name}`)
        if (!empty && rule.type === 'url' && !/^https?:\/\/[^\s]+$/i.test(String(value))) throw new Error(rule.message ?? '请输入有效 URL')
        if (!empty && rule.type === 'number' && (Number.isNaN(Number(value)) || (rule.min != null && Number(value) < rule.min) || (rule.max != null && Number(value) > rule.max))) throw new Error(rule.message ?? '数值超出范围')
      }
    }
    return { ...values } as Values
  }
  return {
    getFieldValue: name => values[String(name)],
    getFieldsValue: names => names ? Object.fromEntries(names.map(name => [String(name), values[String(name)]])) as Partial<Values> : { ...values } as Partial<Values>,
    setFieldValue: (name, value) => { values = { ...values, [String(name)]: value }; notify() },
    setFieldsValue: next => { values = { ...values, ...next }; notify() },
    resetFields: () => { values = { ...initial }; notify() },
    validateFields: async names => validate(names),
    _subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    _snapshot: () => version,
    _setInitial: next => { initial = { ...next }; if (Object.keys(values).length === 0) { values = { ...next }; notify() } },
    _register: (name, nextRules) => { rules.set(name, nextRules); return () => { rules.delete(name) } },
  }
}

const FormContext = createContext<FormInstance | null>(null)

export interface FormProps<Values extends Record<string, any>> {
  form?: FormInstance<Values>
  initialValues?: Partial<Values>
  onFinish?: (values: Values) => void | Promise<void>
  children?: ReactNode
  layout?: 'vertical' | 'horizontal' | 'inline'
  className?: string
}

function FormView<Values extends Record<string, any>>({ form: supplied, initialValues = {}, onFinish, children, layout = 'horizontal', className = '' }: FormProps<Values>) {
  const local = useMemo(() => createForm<Values>(), [])
  const form = supplied ?? local
  useEffect(() => form._setInitial(initialValues), [form])
  const submit = async (event: FormEvent) => { event.preventDefault(); try { await onFinish?.(await form.validateFields()) } catch { /* field validation keeps the form open */ } }
  return <FormContext.Provider value={form as FormInstance}><form className={`ui-form ui-form--${layout} ${className}`.trim()} onSubmit={submit}>{children}</form></FormContext.Provider>
}

export interface FormItemProps {
  name?: string
  label?: ReactNode
  tooltip?: ReactNode
  rules?: FormRule[]
  children?: ReactElement<any>
  className?: string
}

function FormItem({ name, label, tooltip, rules = [], children, className = '' }: FormItemProps) {
  const form = useContext(FormContext)
  useSyncExternalStore(form?._subscribe ?? (() => () => undefined), form?._snapshot ?? (() => 0))
  useEffect(() => name && form ? form._register(name, rules) : undefined, [form, name, rules])
  const child = children ? Children.only(children) : null
  const childProps = (isValidElement(child) ? child.props : {}) as { onChange?: (...args: any[]) => void }
  const control = name && form && isValidElement(child) ? cloneElement(child as any, {
    value: form.getFieldValue(name),
    onChange: (input: any, ...rest: any[]) => {
      childProps.onChange?.(input, ...rest)
      form.setFieldValue(name, input?.target ? input.target.value : input)
    },
  }) : child
  return <label className={`ui-form-item ${className}`.trim()}>{label != null && <span className="ui-form-item__label">{label}{tooltip && <span title={String(tooltip)} className="ui-form-item__tooltip">?</span>}</span>}<span className="ui-form-item__control">{control}</span></label>
}

function useForm<Values extends Record<string, any> = Record<string, any>>(): [FormInstance<Values>] {
  return [useMemo(() => createForm<Values>(), [])]
}

function useWatch<Values extends Record<string, any> = Record<string, any>>(name: keyof Values | string, form: FormInstance<Values>): any {
  useSyncExternalStore(form._subscribe, form._snapshot)
  return form.getFieldValue(name)
}

export const Form = Object.assign(FormView, { Item: FormItem, useForm, useWatch })
