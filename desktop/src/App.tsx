import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { AppRouter } from './app/AppRouter'

export default function App() {
  return <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#347851', borderRadius: 8, fontSize: 14, controlHeight: 36 }, components: { Layout: { siderBg: '#16241f' }, Menu: { darkItemBg: '#16241f', darkItemSelectedBg: '#294137', itemHeight: 42 }, Card: { headerHeight: 44, bodyPadding: 16 }, Form: { itemMarginBottom: 14 }, Tabs: { horizontalItemPadding: '8px 12px', verticalItemPadding: '8px 16px' } } }}><AppRouter /></ConfigProvider>
}
