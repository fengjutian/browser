import type { ReactNode } from 'react'
import { Avatar, Badge, Layout, Menu, Space, Typography } from 'antd'
import { BookOutlined, GlobalOutlined, RobotOutlined, SafetyCertificateOutlined, SearchOutlined, SettingOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { View } from '../types'

const items = [{ key: 'browser', icon: <GlobalOutlined />, label: '浏览器' }, { key: 'library', icon: <BookOutlined />, label: '知识库' }, { key: 'search', icon: <SearchOutlined />, label: '搜索' }, { key: 'ai', icon: <RobotOutlined />, label: 'AI Research' }]

export function AppLayout({ view, onViewChange, children }: { view: View; onViewChange: (view: View) => void; children: ReactNode }) {
  return <Layout className="app-layout"><Layout.Sider width={224} className="app-sider"><div className="brand"><span className="brand__mark"><ThunderboltOutlined /></span><b>Arcadia</b></div><Menu theme="dark" mode="inline" selectedKeys={[view]} items={items} onClick={({ key }) => onViewChange(key as View)} /><div className="sider-spacer"/><div className="privacy-status"><Space><SafetyCertificateOutlined/><b>保护已开启</b></Space><Typography.Text>已拦截 43 个请求</Typography.Text></div><Menu theme="dark" mode="inline" selectedKeys={[view]} items={[{ key: 'settings', icon: <SettingOutlined/>, label: '设置' }]} onClick={() => onViewChange('settings')} /><div className="user-card"><Badge dot color="#65c98b"><Avatar>CF</Avatar></Badge><span><b>Charles</b><small>本地工作区</small></span></div></Layout.Sider><Layout.Content className="app-content">{children}</Layout.Content></Layout>
}
