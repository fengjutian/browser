import { Avatar, message } from 'antd'
import { Alert, Button, Card, Drawer, Empty, Input, List, Space, Spin, Tag, Typography } from '../../components/ui'
import { ArrowRightOutlined, FileTextOutlined, RobotOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../../shared/components/PageHeader'
import { aiChat, listAIProviders, listDocuments } from '../../api'
import { DocumentDetailDrawer } from '../../features/documents/DocumentDetailDrawer'
import { buildCrossAskPrompt, parseCrossAnswer } from '../../features/ai/crossAsk'
import type { AIProvider, Document, View } from '../../types'

const SUGGESTED_PROMPTS = [
  '总结我最近保存的内容',
  '比较这些来源的核心观点',
  '从已保存资料生成研究简报',
]

interface UserTurn {
  id: string
  role: 'user'
  content: string
}
interface AssistantTurn {
  id: string
  role: 'assistant'
  content: string
  docIds: number[]
  notFound: boolean
  pending: boolean
  error?: string
}
type Turn = UserTurn | AssistantTurn

export function AssistantPage({ onNavigate }: { onNavigate?: (view: View) => void }) {
  const [messageApi, contextHolder] = message.useMessage()
  const [documents, setDocuments] = useState<Document[]>([])
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [providerId, setProviderId] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void listDocuments()
      .then(items => setDocuments(items.filter(item => item.status !== 'ARCHIVED')))
      .catch(() => setDocuments([]))
    void listAIProviders()
      .then(items => {
        setProviders(items)
        setProviderId(prev => prev ?? items[0]?.id ?? null)
      })
      .catch(() => { /* non-Tauri fallback */ })
  }, [])

  useEffect(() => {
    const node = listRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [turns])

  const citedDocIds = useMemo(() => {
    const set = new Set<string>()
    turns.forEach(turn => {
      if (turn.role !== 'assistant') return
      turn.docIds.forEach(index => {
        const doc = documents[index - 1]
        if (doc) set.add(doc.id)
      })
    })
    return set
  }, [turns, documents])

  const sourceItems = citedDocIds.size > 0
    ? documents.filter(doc => citedDocIds.has(doc.id))
    : documents.slice(0, 5)

  const noProvider = providers.length === 0
  const noDocuments = documents.length === 0
  const canAsk = !noProvider && !noDocuments && question.trim().length > 0
  const placeholder = noDocuments
    ? '知识库中暂无真实数据'
    : noProvider
      ? '请先在「设置 → AI Provider」中配置'
      : '继续追问…'

  async function ask() {
    if (!providerId) return
    const trimmed = question.trim()
    if (!trimmed || busy) return

    const userTurn: UserTurn = { id: `u-${Date.now()}`, role: 'user', content: trimmed }
    const pendingTurn: AssistantTurn = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: '',
      docIds: [],
      notFound: false,
      pending: true,
    }

    setTurns(current => [...current, userTurn, pendingTurn])
    setQuestion('')
    setBusy(true)

    try {
      const history = turns
        .filter((turn): turn is UserTurn | AssistantTurn => !('pending' in turn && turn.pending))
        .filter(turn => turn.role === 'user' || (!turn.pending && turn.content.length > 0))
        .map(turn => ({ role: turn.role as 'user' | 'assistant', content: turn.content }))
      const request = buildCrossAskPrompt(documents, trimmed, history, { topK: 8 })
      const response = await aiChat(providerId, request)
      const parsed = parseCrossAnswer(response.content)
      setTurns(current => current.map(turn => (
        turn.id === pendingTurn.id
          ? { ...turn, content: parsed.answer, docIds: parsed.docIds, notFound: parsed.notFound, pending: false }
          : turn
      )))
    } catch (caught) {
      const message_ = caught instanceof Error ? caught.message : '提问失败'
      setTurns(current => current.map(turn => (
        turn.id === pendingTurn.id
          ? { ...turn, content: message_, pending: false, error: message_ }
          : turn
      )))
      messageApi.error(message_)
    } finally {
      setBusy(false)
    }
  }

  function applySuggestion(text: string) {
    setQuestion(text)
  }

  function clearConversation() {
    setTurns([])
  }

  function goToProviderSettings() {
    onNavigate?.('settings')
  }

  function resolveCitedDocs(docIds: number[]): Document[] {
    const unique = Array.from(new Set(docIds))
    return unique
      .map(index => documents[index - 1])
      .filter((doc): doc is Document => Boolean(doc))
  }

  return (
    <>
      {contextHolder}
      <section className="page assistant-page">
        <PageHeader
          eyebrow="KNOWLEDGE ASSISTANT"
          title="向整个知识库提问"
          description={`当前基于 ${documents.length} 篇真实保存来源${noProvider ? ' · 未配置 AI Provider' : ''}。`}
        />
        {noProvider && (
          <Alert
            className="assistant-provider-alert"
            type="warning"
            showIcon
            message="尚未配置 AI Provider"
            description="请在“设置 → AI Provider”中添加 OpenAI 兼容或 Ollama 服务。"
            action={onNavigate ? <Button size="small" type="primary" icon={<SettingOutlined />} onClick={goToProviderSettings}>去设置</Button> : undefined}
          />
        )}
        <div className="assistant-grid">
          <Card
            className="assistant-chat"
            title={
              turns.length > 0 ? (
                <Space>
                  <span>对话</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{turns.length} 条</Typography.Text>
                </Space>
              ) : '对话'
            }
            extra={
              <Space>
                <Button size="small" icon={<FileTextOutlined />} onClick={() => setSourcesOpen(true)}>
                  引用来源 {sourceItems.length}
                </Button>
                {turns.length > 0 && <Button size="small" type="link" onClick={clearConversation}>清空</Button>}
              </Space>
            }
          >
            {turns.length === 0 && noDocuments && (
              <div className="assistant-empty">
                <span className="assistant-avatar"><RobotOutlined /></span>
                <Typography.Title level={2}>你想了解什么？</Typography.Title>
                <Typography.Paragraph>请先在浏览器中保存网页，再基于真实资料提问。</Typography.Paragraph>
              </div>
            )}
            {turns.length === 0 && !noDocuments && (
              <div className="assistant-empty">
                <span className="assistant-avatar"><RobotOutlined /></span>
                <Typography.Title level={2}>你想了解什么？</Typography.Title>
                <Typography.Paragraph>比较观点、发现联系，或把真实浏览资料整理成研究简报。</Typography.Paragraph>
                <Space orientation="vertical">
                  {SUGGESTED_PROMPTS.map(text => (
                    <Button key={text} onClick={() => applySuggestion(text)} disabled={noProvider}>{text}</Button>
                  ))}
                </Space>
              </div>
            )}
            {turns.length > 0 && (
              <div className="assistant-conversation" ref={listRef}>
                <List
                  dataSource={turns}
                  renderItem={turn => {
                    if (turn.role === 'user') {
                      return (
                        <List.Item className="assistant-turn assistant-turn--user">
                          <List.Item.Meta
                            avatar={<Avatar icon={<UserOutlined />} style={{ background: '#347851' }} />}
                            title={turn.content}
                          />
                        </List.Item>
                      )
                    }
                    const cited = resolveCitedDocs(turn.docIds)
                    return (
                      <List.Item className="assistant-turn assistant-turn--assistant">
                        <List.Item.Meta
                          avatar={<Avatar icon={<RobotOutlined />} style={{ background: '#16241f' }} />}
                          title={
                            <Space orientation="vertical" size={6} style={{ width: '100%' }}>
                              {turn.pending && <Spin size="small" />}
                              {!turn.pending && turn.error && <Alert type="error" message={turn.error} />}
                              {!turn.pending && !turn.error && turn.notFound && <Alert type="info" message={turn.content} />}
                              {!turn.pending && !turn.error && !turn.notFound && (
                                <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{turn.content}</Typography.Paragraph>
                              )}
                              {!turn.pending && cited.length > 0 && (
                                <Space wrap size={4}>
                                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>引用：</Typography.Text>
                                  {cited.map(doc => (
                                    <Tag
                                      key={doc.id}
                                      className="ai-citation"
                                      onClick={() => setSelectedDoc(doc)}
                                      title="点击查看文档"
                                    >
                                      {doc.title}
                                    </Tag>
                                  ))}
                                </Space>
                              )}
                            </Space>
                          }
                        />
                      </List.Item>
                    )
                  }}
                />
              </div>
            )}
            <div className="assistant-composer">
              <Input
                size="large"
                disabled={noDocuments || busy}
                value={question}
                onChange={event => setQuestion(event.target.value)}
                onPressEnter={() => void ask()}
                placeholder={placeholder}
                suffix={<Button type="primary" shape="circle" icon={<ArrowRightOutlined />} disabled={!canAsk} loading={busy} onClick={() => void ask()} />}
              />
            </div>
          </Card>
        </div>
        <Drawer
          title={`引用来源（${sourceItems.length}）`}
          placement="right"
          width={420}
          open={sourcesOpen}
          onClose={() => setSourcesOpen(false)}
        >
            <List
              dataSource={sourceItems}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无来源" /> }}
              renderItem={item => (
                <List.Item
                  onClick={() => setSelectedDoc(item)}
                  className="search-result-clickable"
                  actions={citedDocIds.has(item.id) ? [<Tag key="cited" color="green">已引用</Tag>] : undefined}
                >
                  <List.Item.Meta
                    avatar={<FileTextOutlined />}
                    title={item.title}
                    description={item.source || item.url}
                  />
                </List.Item>
              )}
            />
        </Drawer>
        <DocumentDetailDrawer
          document={selectedDoc}
          onClose={() => setSelectedDoc(null)}
          onDeleted={() => setSelectedDoc(null)}
        />
      </section>
    </>
  )
}
