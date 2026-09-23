import type { HTMLAttributes, ReactNode } from 'react'
interface LayoutProps extends HTMLAttributes<HTMLDivElement> { children?: ReactNode }
interface SiderProps extends LayoutProps { width?: number | string; collapsedWidth?: number | string; collapsed?: boolean; trigger?: ReactNode }
function LayoutRoot({ className = '', ...props }: LayoutProps) { return <div className={`ant-layout ui-layout ${className}`.trim()} {...props}/> }
function Sider({ width = 200, collapsedWidth = 80, collapsed, className = '', style, trigger: _trigger, children, ...props }: SiderProps) { const size = collapsed ? collapsedWidth : width; return <aside className={`ant-layout-sider ui-layout-sider ${className}`.trim()} style={{ flex: `0 0 ${typeof size === 'number' ? `${size}px` : size}`, width: size, ...style }} {...props}><div className="ant-layout-sider-children">{children}</div></aside> }
function Content({ className = '', ...props }: LayoutProps) { return <main className={`ant-layout-content ui-layout-content ${className}`.trim()} {...props}/> }
export const Layout = Object.assign(LayoutRoot, { Sider, Content })
