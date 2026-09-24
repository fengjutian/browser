import { useState } from 'react'
import { GlobalOutlined } from '../../components/ui/icons'

function faviconCandidates(favicon: string | undefined, pageUrl: string): string[] {
  const candidates: string[] = []
  if (favicon && (/^https:\/\//i.test(favicon) || /^data:image\//i.test(favicon))) candidates.push(favicon)
  try {
    const page = new URL(pageUrl)
    if (page.protocol === 'https:') candidates.push(`${page.origin}/favicon.ico`)
  } catch { /* invalid/new-tab URL */ }
  return [...new Set(candidates)]
}

export function TabFavicon({ favicon, pageUrl }: { favicon?: string; pageUrl: string }) {
  const candidates = faviconCandidates(favicon, pageUrl)
  const [index, setIndex] = useState(0)
  if (!candidates[index]) return <GlobalOutlined aria-label="默认网站图标"/>
  return <img src={candidates[index]} alt="" referrerPolicy="no-referrer" onError={() => setIndex(current => current + 1)}/>
}
