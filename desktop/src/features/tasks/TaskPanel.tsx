import { Empty, Table, Typography, message } from 'antd'
import { Button, Space, Tag, Tooltip } from '../../components/ui'
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import type { Task } from '../../types'
import { listRecentTasks, recoverStaleTasks, retryTask } from '../../api'

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'gold',
  PROCESSING: 'blue',
  COMPLETED: 'green',
  FAILED: 'red',
}

export function TaskPanel() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)
  const [messageApi, contextHolder] = message.useMessage()

  async function refresh() {
    setLoading(true)
    try {
      const recovered = await recoverStaleTasks(120)
      if (recovered > 0) messageApi.info(`回收了 ${recovered} 个长时间无响应的任务`)
      setTasks(await listRecentTasks(50))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  async function retry(task: Task) {
    try {
      await retryTask(task.id)
      messageApi.success('已重新入队')
      await refresh()
    } catch {
      messageApi.error('重试失败')
    }
  }

  return <div className="task-panel">
    {contextHolder}
    <Space style={{marginBottom:8}}>
      <Typography.Title level={3} style={{margin:0}}>任务队列</Typography.Title>
      <Button icon={<SyncOutlined spin={loading}/>} onClick={() => void refresh()}>刷新</Button>
    </Space>
    {tasks.length === 0
      ? <Empty description={loading ? '加载中…' : '暂无任务'}/>
      : <Table<Task>
          size="small"
          rowKey="id"
          dataSource={tasks}
          loading={loading}
          pagination={false}
          columns={[
            {title:'类型',dataIndex:'kind',width:160},
            {title:'状态',dataIndex:'status',width:110,render:(status:string)=><Tag color={STATUS_COLOR[status] ?? 'default'}>{status}</Tag>},
            {title:'进度',width:120,render:(_,task)=>`${task.attempts}/${task.maxAttempts}`},
            {title:'最近错误',dataIndex:'lastError',ellipsis:true,render:(value?:string)=>value ? <Tooltip title={value}><Typography.Text type="danger">{value}</Typography.Text></Tooltip> : <Typography.Text type="secondary">—</Typography.Text>},
            {title:'操作',width:90,render:(_,task)=>task.status === 'FAILED' ? <Button size="small" icon={<ReloadOutlined/>} onClick={()=>void retry(task)}>重试</Button> : null},
          ]}
        />}
  </div>
}
