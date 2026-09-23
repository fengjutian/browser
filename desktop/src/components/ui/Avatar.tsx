import type { CSSProperties, ReactNode } from 'react'
export function Avatar({ icon, children, size = 32, className = '', style }: { icon?: ReactNode; children?: ReactNode; size?: number; className?: string; style?: CSSProperties }) { return <span className={`ui-avatar ${className}`.trim()} style={{ width: size, height: size, ...style }}>{icon ?? children}</span> }
