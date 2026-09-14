import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { AppRouter } from './app/AppRouter'

export default function App() {
  return <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#347851', borderRadius: 10 }, components: { Layout: { siderBg: '#16241f' }, Menu: { darkItemBg: '#16241f', darkItemSelectedBg: '#294137' } } }}><AppRouter /></ConfigProvider>
}
