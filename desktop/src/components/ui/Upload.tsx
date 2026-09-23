import { UploadCloud, X } from 'lucide-react'
import { useRef, type DragEvent, type ReactNode } from 'react'

export interface UploadFile { uid: string; name: string; status?: string }
export interface UploadProps {
  accept?: string
  beforeUpload?: (file: File) => boolean | Promise<boolean>
  onRemove?: (file: UploadFile) => void
  fileList?: UploadFile[]
  children?: ReactNode
  disabled?: boolean
}

function Dragger({ accept, beforeUpload, onRemove, fileList = [], children, disabled }: UploadProps) {
  const ref = useRef<HTMLInputElement>(null)
  const receive = async (files: FileList | null) => {
    const file = files?.[0]
    if (file && !disabled) await beforeUpload?.(file)
    if (ref.current) ref.current.value = ''
  }
  const drop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); void receive(event.dataTransfer.files) }
  return <div className={`ui-upload-dragger${disabled ? ' is-disabled' : ''}`} onDragOver={event => event.preventDefault()} onDrop={drop} onClick={() => !disabled && ref.current?.click()} role="button" tabIndex={disabled ? -1 : 0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') ref.current?.click() }}>
    <input ref={ref} hidden type="file" accept={accept} disabled={disabled} onChange={event => void receive(event.target.files)}/>
    <UploadCloud className="ui-upload-dragger__icon"/>
    <div>{children}</div>
    {fileList.map(file => <div className="ui-upload-dragger__file" key={file.uid} onClick={event => event.stopPropagation()}><span>{file.name}</span><button type="button" aria-label={`移除 ${file.name}`} onClick={() => onRemove?.(file)}><X size={14}/></button></div>)}
  </div>
}

export const Upload = { Dragger }
