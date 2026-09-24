/**
 * Pure helpers for tab visual hints and the new-tab quick-access grid.
 * Extracted from BrowserPage so the logic can be unit-tested without React.
 */
import type { BrowserTab } from '../../types'

export const TAB_GROUP_PALETTE = ['#a7dfbd', '#9bc6e8', '#dfc0a7', '#c8a7df', '#dfb5b5', '#bce0c6']

export const tabGroupColor = (id: string | null | undefined): string => {
  if (!id) return 'transparent'
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return TAB_GROUP_PALETTE[hash % TAB_GROUP_PALETTE.length]
}

export interface QuickSite {
  name: string
  url: string
  initial: string
  color: string
}

export const QUICK_SITES: QuickSite[] = [
  { name: 'GitHub', url: 'https://github.com', initial: 'G', color: '#1f2328' },
  { name: '掘金', url: 'https://juejin.cn', initial: 'J', color: '#1e80ff' },
  { name: 'MDN', url: 'https://developer.mozilla.org', initial: 'M', color: '#1d2421' },
  { name: 'ChatGPT', url: 'https://chat.openai.com', initial: 'C', color: '#10a37f' },
  { name: '知乎', url: 'https://www.zhihu.com', initial: '知', color: '#0084ff' },
  { name: 'Bilibili', url: 'https://www.bilibili.com', initial: 'B', color: '#fb7299' },
  { name: 'arXiv', url: 'https://arxiv.org', initial: 'a', color: '#b31b1b' },
  { name: 'Google Scholar', url: 'https://scholar.google.com', initial: 'S', color: '#4285f4' },
  { name: 'Hacker News', url: 'https://news.ycombinator.com', initial: 'H', color: '#ff6600' },
  { name: 'Wikipedia', url: 'https://www.wikipedia.org', initial: 'W', color: '#1d2421' },
  { name: '百度', url: 'https://www.baidu.com', initial: '百', color: '#2932e1' },
  { name: '微博', url: 'https://weibo.com', initial: '微', color: '#e6162d' },
  { name: '小红书', url: 'https://www.xiaohongshu.com', initial: '红', color: '#ff2442' },
  { name: '淘宝', url: 'https://www.taobao.com', initial: '淘', color: '#ff5000' },
]

export const newTab = (id: string = crypto.randomUUID()): BrowserTab => ({
  id,
  url: '',
  title: '新标签页',
  loading: false,
  active: true,
  pinned: false,
})
