import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Avatar, Badge, Layout, Space, Tooltip, Typography } from 'antd'
import { SafetyCertificateOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { Bot, BookOpen, Globe2, Search, Settings } from 'lucide-react'
import type { View } from '../types'

const items = [{ key: 'browser', icon: <Globe2/>, label: '浏览器' }, { key: 'library', icon: <BookOpen/>, label: '知识库' }, { key: 'search', icon: <Search/>, label: '搜索' }, { key: 'ai', icon: <Bot/>, label: 'AI Research' }] as const

const MIN_SIDER_WIDTH = 72
const MAX_SIDER_WIDTH = 280

export function AppLayout({ view, onViewChange, children }: { view: View; onViewChange: (view: View) => void; children: ReactNode }) {
  const [siderWidth, setSiderWidth] = useState(MIN_SIDER_WIDTH)
  const collapsed = siderWidth === MIN_SIDER_WIDTH

  useEffect(() => {
    document.documentElement.style.setProperty('--sider-width', `${siderWidth}px`)
    return () => { document.documentElement.style.removeProperty('--sider-width') }
  }, [siderWidth])

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = siderWidth
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const resize = (moveEvent: PointerEvent) => {
      setSiderWidth(Math.min(MAX_SIDER_WIDTH, Math.max(MIN_SIDER_WIDTH, startWidth + moveEvent.clientX - startX)))
    }
    const stop = () => {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  function navButton(item: { key: View; icon: ReactNode; label: string }) {
    const button = <button type="button" className={`rail-button${view === item.key ? ' is-active' : ''}`} aria-label={item.label} aria-current={view === item.key ? 'page' : undefined} onClick={() => onViewChange(item.key)}><span className="nav-glyph">{item.icon}</span><span className="rail-button__label">{item.label}</span></button>
    return collapsed ? <Tooltip key={item.key} title={item.label} placement="right" mouseEnterDelay={0.5}>{button}</Tooltip> : <span key={item.key}>{button}</span>
  }

  return <Layout className="app-layout"><Layout.Sider width={siderWidth} collapsedWidth={MIN_SIDER_WIDTH} collapsed={collapsed} trigger={null} className={`app-sider${collapsed ? ' app-sider--collapsed' : ''}`}><div className="brand"><span className="brand__mark"><ThunderboltOutlined /></span><b>Arcadia</b></div><nav className="rail-nav rail-nav--primary" aria-label="主导航">{items.map(navButton)}</nav><div className="sider-spacer"/><div className="privacy-status"><Space><SafetyCertificateOutlined/><b>保护已开启</b></Space><Typography.Text>已拦截 43 个请求</Typography.Text></div><nav className="rail-nav rail-nav--utility" aria-label="辅助导航">{navButton({ key: 'settings', icon: <Settings/>, label: '设置' })}</nav><div className="user-card"><Badge dot color="#65c98b"><Avatar>CF</Avatar></Badge><span><b>Charles</b><small>本地工作区</small></span></div><div className="sider-resizer" role="separator" aria-label="调整左侧栏宽度" aria-orientation="vertical" aria-valuemin={MIN_SIDER_WIDTH} aria-valuemax={MAX_SIDER_WIDTH} aria-valuenow={siderWidth} onPointerDown={startResize}/></Layout.Sider><Layout.Content className="app-content">{children}</Layout.Content></Layout>
}
