import { useEffect, useState } from 'react'
import { readProcessMemory, type ProcessMemorySnapshot } from '../../services/processMemory'

export interface UseProcessMemoryOptions {
  /** Polling interval in ms; defaults to 5s. */
  intervalMs?: number
  /** Set to `false` to pause polling (e.g. when the panel is hidden). */
  enabled?: boolean
}

export interface UseProcessMemoryResult {
  snapshot: ProcessMemorySnapshot | null
  /** True when the latest poll returned null (Tauri unavailable or unsupported OS). */
  unsupported: boolean
}

/**
 * Polls the Rust `browser_process_memory` command and keeps the latest
 * snapshot in component state. Cleans up the timer on unmount and pauses
 * automatically when `enabled` flips to `false`.
 */
export function useProcessMemory({ intervalMs = 5000, enabled = true }: UseProcessMemoryOptions = {}): UseProcessMemoryResult {
  const [snapshot, setSnapshot] = useState<ProcessMemorySnapshot | null>(null)
  const [unsupported, setUnsupported] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: number | null = null

    const sample = async () => {
      const next = await readProcessMemory()
      if (cancelled) return
      if (next == null) {
        setSnapshot(prev => prev)
        setUnsupported(true)
        return
      }
      setUnsupported(false)
      setSnapshot(next)
    }

    void sample()
    timer = window.setInterval(() => void sample(), intervalMs)

    return () => {
      cancelled = true
      if (timer != null) window.clearInterval(timer)
    }
  }, [intervalMs, enabled])

  return { snapshot, unsupported }
}