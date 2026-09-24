import { type MouseEvent, useState } from 'react'
import { Button, Input, Segmented, Select, Typography } from '../../components/ui'
import { SearchOutlined } from '../../components/ui/icons'
import { readSearchEngineConfig, renderSearchTemplate, SEARCH_ENGINE_PRESETS } from './searchEngine'
import { classifyNavigationInput } from './navigation'
import { QUICK_SITES } from './browserUtils'

type SearchMode = 'web' | 'knowledge'

export function NewTab({ address, setAddress, navigate, openNewTab, onSearchKnowledge }: {
  address: string
  setAddress: (value: string) => void
  navigate: (input: string) => Promise<void>
  openNewTab: (url?: string) => void
  onSearchKnowledge?: (query: string) => void
}) {
  const configuredEngine = readSearchEngineConfig().presetId
  const initialEngine = SEARCH_ENGINE_PRESETS.some(engine => engine.id === configuredEngine) ? configuredEngine : 'google'
  const [mode, setMode] = useState<SearchMode>('web')
  const [engines, setEngines] = useState<string[]>([initialEngine])
  const presets = SEARCH_ENGINE_PRESETS.map(item => ({ label: item.label, value: item.id }))
  const placeholder = mode === 'knowledge' ? '搜索本地知识库' : '搜索网页或输入 URL'

  function templateFor(id: string) { return SEARCH_ENGINE_PRESETS.find(item => item.id === id)?.template ?? SEARCH_ENGINE_PRESETS[0].template }
  function submit() {
    const query = address.trim()
    if (!query) return
    if (mode === 'knowledge') { onSearchKnowledge?.(query); return }
    if (classifyNavigationInput(query) !== 'search') { void navigate(query); return }
    const selected = engines.length ? engines : [initialEngine]
    const urls = selected.map(id => renderSearchTemplate(templateFor(id), query))
    void navigate(urls[0])
    urls.slice(1).forEach(url => openNewTab(url))
  }

  return <div className="new-tab"><div className="new-tab__hero"><Typography.Title>今天想探索什么？</Typography.Title><Typography.Paragraph>在网页与个人知识之间，选择最合适的探索方式。</Typography.Paragraph></div><div className="new-tab-search"><Segmented<SearchMode> block value={mode} onChange={setMode} options={[{label:'网页搜索',value:'web'},{label:'本地知识库',value:'knowledge'}]}/><form onSubmit={event=>{event.preventDefault();submit()}}><Input size="large" autoFocus prefix={<SearchOutlined/>} value={address} onChange={event=>setAddress(event.target.value)} placeholder={placeholder} suffix={<Button type="primary" htmlType="submit">{mode === 'knowledge' ? '查询' : '搜索'}</Button>}/></form>{mode === 'web' && <div className="search-engine-picker"><span>搜索引擎</span><Select mode="multiple" maxTagCount="responsive" value={engines} onChange={setEngines} options={presets} placeholder="选择一个或多个搜索引擎"/></div>}{mode === 'knowledge' && <div className="new-tab-search__hint">仅查询保存在本机的网页、笔记和标签，不会发送到外部搜索引擎。</div>}</div><div className="quick-sites"><div className="quick-sites__label">常用网站</div><div className="quick-sites__grid">{QUICK_SITES.map(site => <button key={site.url} type="button" className="quick-site" title={site.name} aria-label={`打开 ${site.name}`} onClick={(event: MouseEvent<HTMLButtonElement>)=>{event.currentTarget.blur();void navigate(site.url)}}><span className="quick-site__mark" style={{background:site.color}}>{site.initial}</span><span className="quick-site__name">{site.name}</span></button>)}</div></div></div>
}
