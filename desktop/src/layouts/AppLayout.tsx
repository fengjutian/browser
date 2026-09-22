import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Avatar, Badge, Layout, Menu, Space, Typography } from 'antd'
import { SafetyCertificateOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { View } from '../types'

function NavIcon({ type }: { type: 'browser' | 'library' | 'search' | 'ai' | 'settings' }) {
  const paths = {
    browser: <><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.4 2.2 3.6 4.9 3.6 8S14.4 17.8 12 20M12 4c-2.4 2.2-3.6 4.9-3.6 8s1.2 5.8 3.6 8"/></>,
    library: <><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H11a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H5z"/><path d="M19 5.5A2.5 2.5 0 0 0 16.5 3H14v17a3 3 0 0 1 3-3h2z"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/></>,
    ai: <><rect x="5" y="6" width="14" height="12" rx="3"/><path d="M9 11h.01M15 11h.01M9 15h6M12 3v3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7a7 7 0 0 0-.7-1.7l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.7-.7L10.5 2h-3l-.7 2a7 7 0 0 0-1.7.7l-1.9-.9-2.1 2.1.9 1.9a7 7 0 0 0-.7 1.7L0 10.5v3l2 .7a7 7 0 0 0 .7 1.7l-.9 1.9 2.1 2.1 1.9-.9a7 7 0 0 0 1.7.7l.7 2.3h3l.7-2a7 7 0 0 0 1.7-.7l1.9.9 2.1-2.1-.9-1.9a7 7 0 0 0 .7-1.7z" transform="translate(2) scale(.83)"/></>,
  }
  return <span className="nav-glyph"><svg viewBox="0 0 24 24" aria-hidden="true">{paths[type]}</svg></span>
}

const items = [{ key: 'browser', icon: <NavIcon type="browser"/>, label: '浏览器' }, { key: 'library', icon: <NavIcon type="library"/>, label: '知识库' }, { key: 'search', icon: <NavIcon type="search"/>, label: '搜索' }, { key: 'ai', icon: <NavIcon type="ai"/>, label: 'AI Research' }]

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

  return <Layout className="app-layout"><Layout.Sider width={siderWidth} collapsedWidth={MIN_SIDER_WIDTH} collapsed={collapsed} trigger={null} className={`app-sider${collapsed ? ' app-sider--collapsed' : ''}`}><div className="brand"><span className="brand__mark"><ThunderboltOutlined /></span><b>Arcadia</b></div><Menu className="nav-menu nav-menu--primary" theme="light" mode="inline" inlineCollapsed={collapsed} selectedKeys={[view]} items={items} onClick={({ key }) => onViewChange(key as View)} /><div className="sider-spacer"/><div className="privacy-status"><Space><SafetyCertificateOutlined/><b>保护已开启</b></Space><Typography.Text>已拦截 43 个请求</Typography.Text></div><Menu className="nav-menu nav-menu--utility" theme="light" mode="inline" inlineCollapsed={collapsed} selectedKeys={[view]} items={[{ key: 'settings', icon: <NavIcon type="settings"/>, label: '设置' }]} onClick={() => onViewChange('settings')} /><div className="user-card"><Badge dot color="#65c98b"><Avatar>CF</Avatar></Badge><span><b>Charles</b><small>本地工作区</small></span></div><div className="sider-resizer" role="separator" aria-label="调整左侧栏宽度" aria-orientation="vertical" aria-valuemin={MIN_SIDER_WIDTH} aria-valuemax={MAX_SIDER_WIDTH} aria-valuenow={siderWidth} onPointerDown={startResize}/></Layout.Sider><Layout.Content className="app-content">{children}</Layout.Content></Layout>
}
