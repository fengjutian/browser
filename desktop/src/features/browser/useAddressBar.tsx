import { InputRef } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildSuggestions, type SuggestionItem } from './suggestionProvider'
import { trimSuggestions } from './suggestionProvider'
import { renderSuggestion } from './suggestionRenderer'
import { resolveActiveSearchTemplate, readSearchEngineConfig } from './searchEngine'
import type { HistoryEntry } from './types'

export interface AddressSuggestionOption {
  value: string
  label: React.ReactNode
}

export interface UseAddressBarInput {
  initialAddress?: string
  openTabs: Array<{ url: string; title: string }>
  history: HistoryEntry[]
  /**
   * Active tab URL. When it changes, the address bar syncs to the new value
   * (unless the user is currently typing).
   */
  activeUrl?: string
}

export interface UseAddressBarResult {
  address: string
  setAddress: (value: string) => void
  suggestions: AddressSuggestionOption[]
  inputRef: React.RefObject<InputRef | null>
  focus: () => void
  clear: () => void
}

/**
 * Encapsulates the address-bar state machine used by `BrowserPage`. Owns the
 * raw `address` text, the autocomplete suggestions, and the input ref. The
 * caller is responsible for the actual navigation; this hook only manages
 * display + suggestions and exposes helpers (`clear`, `focus`) used in
 * shortcuts and external navigation paths.
 */
export function useAddressBar(input: UseAddressBarInput): UseAddressBarResult {
  const { initialAddress = '', openTabs, history, activeUrl } = input
  const [address, setAddressState] = useState(initialAddress)
  const [userTyping, setUserTyping] = useState(false)
  const inputRef = useRef<InputRef | null>(null)
  const searchTemplate = useMemo(() => resolveActiveSearchTemplate(readSearchEngineConfig()), [])

  // Sync the active tab URL into the bar when the tab changes — but never
  // overwrite a user who is mid-typing.
  useEffect(() => {
    if (userTyping) return
    if (activeUrl === undefined) return
    setAddressState(activeUrl)
  }, [activeUrl, userTyping])

  const setAddress = useCallback((value: string) => {
    setUserTyping(true)
    setAddressState(value)
  }, [])

  const clear = useCallback(() => {
    setUserTyping(false)
    setAddressState('')
  }, [])

  const focus = useCallback(() => {
    inputRef.current?.focus({ cursor: 'all' })
  }, [])

  const suggestions = useMemo<AddressSuggestionOption[]>(() => {
    const built: SuggestionItem[] = buildSuggestions({
      query: address,
      openTabs,
      history,
      bookmarks: [],
      searchTemplate,
    })
    return trimSuggestions(built, 8).map(item => ({
      value: item.url,
      label: renderSuggestion(item),
    }))
  }, [address, history, openTabs, searchTemplate])

  return { address, setAddress, suggestions, inputRef, focus, clear }
}