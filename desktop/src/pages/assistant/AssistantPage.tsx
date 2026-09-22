import { Alert, Button, Card, Empty, Input, List, Space, Spin, Tag, Typography, message } from 'antd'
import { ArrowRightOutlined, FileTextOutlined, RobotOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../shared/components/PageHeader'
import { aiChat, listAIProviders, listDocuments } from '../../api'
import { DocumentDetailDrawer } from '../../features/documents/DocumentDetailDrawer'
import { buildCrossAskPrompt, parseCrossAnswer } from '../../features/ai/crossAsk'
import type { AIProvider, Document } from '../../types'

const SUGGESTED_PROMPTS = [
  '总结我最近保存的内容',
  '比较这些来源的核心观点',
  '从已保存资料生成研究简报',
]

export function AssistantPage() {
  const [messageApi, contextHolder] = message.useMessage()
  const [documents, setDocuments] = useState<Document[]>([])
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [providerId, setProviderId] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [docIds, setDocIds] = useState<number[]>([])
  const [notFound, setNotFound] = useState(false)
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null)

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

  const citedDocuments = useMemo(() => {
    if (docIds.length === 0) return []
    const unique = Array.from(new Set(docIds))
    return unique
      .map(index => documents[index - 1])
      .filter((doc): doc is Document => Boolean(doc))
  }, [docIds, documents])

  const noProvider = providers.length === 0
  const noDocuments = documents.length === 0
  const canAsk = !noProvider && !noDocuments && question.trim().length > 0

  async function ask() {
    if (!providerId) {
      setError('请先在「设置 → AI Provider」中配置一个 Provider。')
      return
    }
    const trimmed = question.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    setAnswer('')
    setDocIds([])
    setNotFound(false)
    try {
      const request = buildCrossAskPrompt(documents, trimmed)
      const response = await aiChat(providerId, request)
      const parsed = parseCrossAnswer(response.content)
      setAnswer(parsed.answer)
      setDocIds(parsed.docIds)
      setNotFound(parsed.notFound)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '提问失败')
    } finally {
      setBusy(false)
    }
  }

  function applySuggestion(text: string) {
    setQuestion(text)
  }

  const placeholder = noDocuments
    ? '知识库中暂无真实数据'
    : noProvider
      ? '请先在「设置 → AI Provider」中配置'
      : '向知识库提问…'

  const showResult = busy || Boolean(error) || Boolean(answer)
  const citedSet = new Set(citedDocuments.map(doc => doc.id))
  const sourceItems = citedDocuments.length > 0 ? citedDocuments : documents.slice(0, 5)

  return (
    <>
      {contextHolder}
      <section className="page">
        <PageHeader
          eyebrow="KNOWLEDGE ASSISTANT"
          title="向整个知识库提问"
          description={`当前基于 ${documents.length} 篇真实保存来源${noProvider ? ' · 未配置 AI Provider' : ''}。`}
        />
        <div className="assistant-grid">
          <Card className="assistant-chat">
            {!showResult && noDocuments && (
              <div className="assistant-empty">
                <span className="assistant-avatar"><RobotOutlined /></span>
                <Typography.Title level={2}>你想了解什么？</Typography.Title>
                <Typography.Paragraph>请先在浏览器中保存网页，再基于真实资料提问。</Typography.Paragraph>
              </div>
            )}
            {!showResult && !noDocuments && (
              <div className="assistant-empty">
                <span className="assistant-avatar"><RobotOutlined /></span>
                <Typography.Title level={2}>你想了解什么？</Typography.Title>
                <Typography.Paragraph>比较观点、发现联系，或把真实浏览资料整理成研究简报。</Typography.Paragraph>
                <Space direction="vertical">
                  {SUGGESTED_PROMPTS.map(text => (
                    <Button key={text} onClick={() => applySuggestion(text)}>{text}</Button>
                  ))}
                </Space>
              </div>
            )}
            {showResult && (
              <div className="assistant-answer">
                {busy && <Spin />}
                {error && <Alert type="error" message={error} />}
                {!busy && notFound && <Alert type="info" message={answer} />}
                {!busy && !notFound && answer && (
                  <>
                    <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{answer}</Typography.Paragraph>
                    {citedDocuments.length > 0 && (
                      <Space wrap style={{ marginTop: 8 }}>
                        <Typography.Text type="secondary">引用：</Typography.Text>
                        {citedDocuments.map(doc => (
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
                  </>
                )}
              </div>
            )}
            <Input
              size="large"
              disabled={noDocuments || busy}
              value={question}
              onChange={event => setQuestion(event.target.value)}
              onPressEnter={() => void ask()}
              placeholder={placeholder}
              suffix={
                <Button
                  type="primary"
                  shape="circle"
                  icon={<ArrowRightOutlined />}
                  disabled={!canAsk}
                  loading={busy}
                  onClick={() => void ask()}
                />
              }
            />
          </Card>
          <Card
            title="引用来源"
            extra={<Typography.Text type="secondary">{sourceItems.length} 条</Typography.Text>}
          >
            <List
              dataSource={sourceItems}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无来源" /> }}
              renderItem={item => (
                <List.Item
                  onClick={() => setSelectedDoc(item)}
                  className="search-result-clickable"
                  actions={citedSet.has(item.id) ? [<Tag key="cited" color="green">已引用</Tag>] : undefined}
                >
                  <List.Item.Meta
                    avatar={<FileTextOutlined />}
                    title={item.title}
                    description={item.source || item.url}
                  />
                </List.Item>
              )}
            />
          </Card>
        </div>
        <DocumentDetailDrawer
          document={selectedDoc}
          onClose={() => setSelectedDoc(null)}
          onDeleted={() => setSelectedDoc(null)}
        />
      </section>
    </>
  )
}
