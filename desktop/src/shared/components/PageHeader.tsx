import { Button, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: string }) {
  return <header className="page-header"><div><Typography.Text className="eyebrow">{eyebrow}</Typography.Text><Typography.Title level={1}>{title}</Typography.Title><Typography.Paragraph>{description}</Typography.Paragraph></div>{action && <Button type="primary" icon={<PlusOutlined/>}>{action}</Button>}</header>
}
