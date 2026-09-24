import type { SuggestionItem } from './suggestionProvider'

const SOURCE_LABELS: Record<SuggestionItem['source'], string> = {
  'open-tab': '已打开',
  history: '历史',
  bookmark: '书签',
  search: '搜索',
}

export function renderSuggestion(item: SuggestionItem) {
  const sourceLabel = SOURCE_LABELS[item.source]
  return (
    <div className="address-suggestion">
      <b>{item.title || item.url}</b>
      <small>{item.url}</small>
      <span className={`address-suggestion__source address-suggestion__source--${item.source}`}>{sourceLabel}</span>
    </div>
  )
}
