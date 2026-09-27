import type { ChatMessage } from '../../types'

export interface StoredConversationTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  docIds?: number[]
  notFound?: boolean
  error?: string
}

export function parseStoredConversation(raw: string | null): StoredConversationTurn[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    return value.filter((item): item is StoredConversationTurn => {
      if (!item || typeof item !== 'object') return false
      const turn = item as Partial<StoredConversationTurn>
      return typeof turn.id === 'string'
        && (turn.role === 'user' || turn.role === 'assistant')
        && typeof turn.content === 'string'
        && turn.content.length <= 100_000
    }).slice(-200)
  } catch { return [] }
}

/** Keep recent complete turns inside a character budget without splitting a message. */
export function compactChatHistory(messages: readonly ChatMessage[], maxChars = 12_000): ChatMessage[] {
  const budget = Math.max(0, maxChars)
  const kept: ChatMessage[] = []
  let used = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (kept.length > 0 && used + message.content.length > budget) break
    if (kept.length === 0 && message.content.length > budget) {
      kept.unshift({ ...message, content: message.content.slice(-budget) })
      break
    }
    kept.unshift(message)
    used += message.content.length
  }
  return kept
}
