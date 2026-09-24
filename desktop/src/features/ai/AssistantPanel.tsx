import { Alert, Button, Card, Empty, Input, message, Segmented, Select, Space, Spin, Tag, Typography } from '../../components/ui'
import { ArrowRightOutlined, BookOutlined, CloseOutlined, CopyOutlined, GlobalOutlined, RobotOutlined, SaveOutlined, ThunderboltOutlined, TranslationOutlined } from '../../components/ui/icons'
import { useEffect, useMemo, useState } from 'react'
import { aiChat, findDocumentByUrl, getSession, listAIProviders, setSession, updateDocument } from '../../api'
import type { AIProvider } from '../../types'
import type { ReaderArticle } from '../reader/types'
import { buildAskPrompt, numberPassages, parseAnswer, passageById } from './ask'
import { buildSummaryPrompt, summaryKindLabel, type SummaryKind } from './summarize'
import { TRANSLATION_VIEW_LABEL, buildTranslatePrompt, detectTranslationTarget, translationKey, type TranslationView } from './translate'

type PanelMode = 'summarize' | 'ask' | 'translate'

interface AssistantPanelProps {
  close: () => void
  saveToLibrary: () => Promise<void>
  currentUrl: string
  currentTabId: string
  readerArticle: ReaderArticle | null
  initialQuestion?: string
  initialMode?: PanelMode
  translationSource?: string
}

const TRANSLATION_LANGUAGES = [
  { value: 'zh-CN', label: '中文（简体）' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
]

interface TranslationCacheEntry { key: string; content: string }

export function AssistantPanel({ close, saveToLibrary, currentUrl, currentTabId, readerArticle, initialQuestion = '', initialMode, translationSource = '' }: AssistantPanelProps) {
  const [messageApi, contextHolder] = message.useMessage()
  const [mode, setMode] = useState<PanelMode>('summarize')
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [providerId, setProviderId] = useState<string | null>(null)
  const [kind, setKind] = useState<SummaryKind>('short')
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [askAnswer, setAskAnswer] = useState('')
  const [askCitations, setAskCitations] = useState<string[]>([])
  const [askNotFound, setAskNotFound] = useState(false)
  const [targetLanguage, setTargetLanguage] = useState('zh-CN')
  const [translationView, setTranslationView] = useState<TranslationView>('translation-only')
  const [translation, setTranslation] = useState('')
  const [cache, setCache] = useState<TranslationCacheEntry[]>([])

  useEffect(() => {
    void listAIProviders().then(list => {
      setProviders(list)
      setProviderId(prev => prev ?? list[0]?.id ?? null)
    }).catch(() => { /* non-Tauri fallback */ })
  }, [])

  useEffect(() => {
    setSummary(''); setError(null); setAskAnswer(''); setAskCitations([]); setAskNotFound(false); setQuestion(''); setTranslation('')
  }, [currentUrl, mode])

  useEffect(() => {
    if (!initialQuestion.trim()) return
    setMode('ask')
    setQuestion(initialQuestion.trim())
  }, [initialQuestion])

  useEffect(() => {
    if (initialMode) setMode(initialMode)
    if (initialMode === 'translate') {
      const source = translationSource.trim() || readerArticle?.markdown || ''
      setTargetLanguage(detectTranslationTarget(source))
    }
  }, [initialMode, translationSource, readerArticle?.markdown])

  useEffect(() => {
    void getSession('ai.translations').then(raw => {
      if (!raw) { setCache([]); return }
      try {
        const parsed = JSON.parse(raw) as TranslationCacheEntry[]
        if (Array.isArray(parsed)) setCache(parsed.slice(0, 50))
      } catch { setCache([]) }
    })
  }, [])

  const passages = useMemo(() => readerArticle ? numberPassages(readerArticle.markdown ?? '') : [], [readerArticle])

  async function generateSummary() {
    if (!providerId) { setError('请先在「设置 → AI Provider」中配置一个 Provider。'); return }
    const markdown = (translationSource || readerArticle?.markdown || '').trim()
    if (!markdown) { setError('请先打开「阅读模式」提取页面正文。'); return }
    setBusy(true); setError(null); setSummary('')
    try {
      const request = buildSummaryPrompt(markdown, kind, readerArticle?.title || currentUrl)
      const response = await aiChat(providerId, request)
      setSummary(response.content)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '生成摘要失败') }
    finally { setBusy(false) }
  }

  async function askQuestion() {
    if (!providerId) { setError('请先在「设置 → AI Provider」中配置一个 Provider。'); return }
    const markdown = readerArticle?.markdown?.trim()
    const trimmed = question.trim()
    if (!markdown) { setError('请先打开「阅读模式」提取页面正文。'); return }
    if (!trimmed) { setError('请输入问题。'); return }
    setBusy(true); setError(null); setAskAnswer(''); setAskCitations([]); setAskNotFound(false)
    try {
      const request = buildAskPrompt(markdown, trimmed, readerArticle?.title || currentUrl)
      const response = await aiChat(providerId, request)
      const parsed = parseAnswer(response.content)
      setAskAnswer(parsed.answer)
      setAskCitations(parsed.citations)
      setAskNotFound(parsed.notFound)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '回答失败') }
    finally { setBusy(false) }
  }

  async function translateArticle() {
    if (!providerId) { setError('请先在「设置 → AI Provider」中配置一个 Provider。'); return }
    const markdown = readerArticle?.markdown?.trim()
    if (!markdown) { setError('请先打开「阅读模式」提取页面正文。'); return }
    const input = { markdown, targetLanguage, view: translationView }
    const key = translationKey(input)
    const hit = cache.find(entry => entry.key === key)
    if (hit) { setTranslation(hit.content); return }
    setBusy(true); setError(null); setTranslation('')
    try {
      const request = buildTranslatePrompt(input)
      const response = await aiChat(providerId, request)
      const content = response.content
      const next = [{ key, content }, ...cache.filter(entry => entry.key !== key)].slice(0, 50)
      setCache(next)
      void setSession('ai.translations', JSON.stringify(next))
      setTranslation(content)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '翻译失败') }
    finally { setBusy(false) }
  }

  async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text); messageApi.success('已复制') }
    catch { messageApi.error('复制失败，请检查浏览器权限') }
  }

  async function saveAsDocumentSummary() {
    if (!summary) return
    try {
      const document = await findDocumentByUrl(currentUrl)
      if (!document) { messageApi.warning('请先保存网页到知识库，再写入摘要'); return }
      await updateDocument(document.id, { summary })
      messageApi.success('摘要已写入文档')
    } catch (caught) { messageApi.error(caught instanceof Error ? caught.message : '保存失败') }
  }

  const currentProvider = providers.find(item => item.id === providerId)
  const noProvider = providers.length === 0
  const noArticle = !readerArticle?.markdown?.trim()
  const noTranslationSource = !(translationSource || readerArticle?.markdown || '').trim()

  return <>{contextHolder}<aside className="ai-panel">
    <div className="panel-title"><Space><span className="ai-mark"><RobotOutlined/></span><b>AI Assistant</b></Space><Button type="text" icon={<CloseOutlined/>} onClick={close}/></div>
    <Segmented block value={mode} onChange={value => setMode(value as PanelMode)} options={[
      {label:'摘要',value:'summarize' as PanelMode},
      {label:'提问',value:'ask' as PanelMode},
      {label:'翻译',value:'translate' as PanelMode},
    ]}/>
    <Space wrap className="ai-panel__provider">
      <Tag icon={<RobotOutlined/>} color={currentProvider ? 'green' : 'default'}>
        {currentProvider ? `${currentProvider.type} · ${currentProvider.model}` : '未配置 Provider'}
      </Tag>
      {providers.length > 1 && <Select<string> size="small" value={providerId ?? undefined} onChange={setProviderId} options={providers.map(item => ({label:item.model,value:item.id}))} style={{minWidth:160}}/>}
    </Space>
    <Card size="small" className="context-card">
      {readerArticle
        ? <><GlobalOutlined/> 阅读模式 · {readerArticle.wordCount} 字<Tag color="success">就绪</Tag></>
        : <><GlobalOutlined/> 当前页面<Tag>请先进入阅读模式</Tag></>}
    </Card>

    {mode === 'summarize' && (
      <>
        <Segmented block value={kind} onChange={value => setKind(value as SummaryKind)} options={[
          {label:'一句话',value:'one-sentence'},
          {label:'简短',value:'short'},
          {label:'详细',value:'detailed'},
          {label:'观点',value:'key-points'},
        ]}/>
        <Space orientation="vertical" className="panel-actions">
          <Button block icon={<ThunderboltOutlined/>} onClick={() => void generateSummary()} loading={busy} disabled={noProvider || noArticle}>生成 {summaryKindLabel(kind)}</Button>
          <Button block icon={<CopyOutlined/>} onClick={() => void copyText(summary)} disabled={!summary}>复制摘要</Button>
          <Button block icon={<ThunderboltOutlined/>} onClick={() => void generateSummary()} disabled={busy || noProvider || !summary}>重新生成</Button>
        </Space>
        <Card className="ai-result" size="small">
          {busy && <Spin/>}
          {error && <Alert type="error" message={error}/>}
          {!busy && !error && summary && <Typography.Paragraph style={{whiteSpace:'pre-wrap'}}>{summary}</Typography.Paragraph>}
          {!busy && !error && !summary && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="生成结果将出现在这里"/>}
        </Card>
        <Space orientation="vertical" style={{width:'100%'}}>
          <Button block icon={<SaveOutlined/>} onClick={() => void saveAsDocumentSummary()} disabled={!summary}>把摘要写回文档</Button>
          <Button block onClick={() => void saveToLibrary()}>保存到知识库</Button>
        </Space>
      </>
    )}

    {mode === 'ask' && (
      <>
        <Space orientation="vertical" className="panel-actions" style={{width:'100%'}}>
          <Input.TextArea autoSize={{minRows:2,maxRows:4}} value={question} onChange={event => setQuestion(event.target.value)} placeholder="向当前页面提问…" disabled={busy}/>
          <Button block type="primary" icon={<ArrowRightOutlined/>} onClick={() => void askQuestion()} loading={busy} disabled={noProvider || noArticle || !question.trim()}>提问</Button>
        </Space>
        <Card className="ai-result" size="small">
          {busy && <Spin/>}
          {error && <Alert type="error" message={error}/>}
          {!busy && !error && askAnswer && (
            <>
              {askNotFound
                ? <Alert type="info" message={askAnswer}/>
                : <Typography.Paragraph style={{whiteSpace:'pre-wrap'}}>{askAnswer}</Typography.Paragraph>}
              {!askNotFound && askCitations.length > 0 && (
                <Space wrap style={{marginTop:8}}>
                  <Typography.Text type="secondary">引用：</Typography.Text>
                  {askCitations.map(id => {
                    const passage = passageById(passages, id)
                    return <Tag key={id} className="ai-citation" onClick={() => passage && void copyText(passage.text)} title={passage ? '点击复制段落原文' : '未找到段落'}>{id}</Tag>
                  })}
                </Space>
              )}
            </>
          )}
          {!busy && !error && !askAnswer && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="回答将出现在这里"/>}
        </Card>
      </>
    )}

    {mode === 'translate' && (
      <>
        <Space wrap>
          <Select<string> size="small" value={targetLanguage} onChange={setTargetLanguage} options={TRANSLATION_LANGUAGES} style={{minWidth:160}}/>
          <Segmented size="small" value={translationView} onChange={value => setTranslationView(value as TranslationView)} options={[
            {label:TRANSLATION_VIEW_LABEL['translation-only'],value:'translation-only'},
            {label:TRANSLATION_VIEW_LABEL.bilingual,value:'bilingual'},
          ]}/>
        </Space>
        <Space orientation="vertical" className="panel-actions" style={{width:'100%'}}>
          <Button block type="primary" icon={<TranslationOutlined/>} onClick={() => void translateArticle()} loading={busy} disabled={noProvider || noTranslationSource}>翻译{translationSource ? '选中内容' : '当前页面'}</Button>
          <Button block icon={<CopyOutlined/>} onClick={() => void copyText(translation)} disabled={!translation}>复制译文</Button>
        </Space>
        <Card className="ai-result" size="small">
          {busy && <Spin/>}
          {error && <Alert type="error" message={error}/>}
          {!busy && !error && translation && <Typography.Paragraph style={{whiteSpace:'pre-wrap'}}>{translation}</Typography.Paragraph>}
          {!busy && !error && !translation && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="译文将出现在这里"/>}
        </Card>
        {cache.length > 0 && <Typography.Text type="secondary" style={{fontSize:12}}>缓存 {cache.length} 条历史翻译</Typography.Text>}
      </>
    )}
  </aside></>
}
