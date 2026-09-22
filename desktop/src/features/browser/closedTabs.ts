export interface ClosedTab {
  id: string
  url: string
  title: string
  favicon?: string
  closedAt: number
}

export const CLOSED_TABS_MAX = 20

export function recordClosedTab(closed: ClosedTab[], tab: ClosedTab): ClosedTab[] {
  const filtered = closed.filter(item => item.url !== tab.url)
  filtered.unshift(tab)
  if (filtered.length > CLOSED_TABS_MAX) filtered.length = CLOSED_TABS_MAX
  return filtered
}

export function popClosedTab(closed: ClosedTab[]): { popped: ClosedTab; remaining: ClosedTab[] } | null {
  if (closed.length === 0) return null
  const [popped, ...rest] = closed
  return { popped, remaining: rest }
}
