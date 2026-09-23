import { describe, expect, it } from 'vitest'
import { formatBytes } from './processMemory'

describe('processMemory.formatBytes', () => {
  it('returns em-dash for null and undefined', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(undefined)).toBe('—')
  })

  it('renders bytes under 1 KiB as B', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('steps units KB → MB → GB', () => {
    expect(formatBytes(1024)).toBe('1.00 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB')
  })

  it('chooses 0/1/2 fractional digits by magnitude', () => {
    expect(formatBytes(200 * 1024)).toBe('200 KB')
    expect(formatBytes(50 * 1024)).toBe('50.0 KB')
    expect(formatBytes(5 * 1024)).toBe('5.00 KB')
  })

  it('caps at TB', () => {
    const result = formatBytes(1024n ** 4n ? Number(1024n ** 4n) : 1024 * 1024 * 1024 * 1024)
    expect(result.endsWith('TB')).toBe(true)
  })
})