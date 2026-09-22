import { describe, expect, it } from 'vitest'
import { evaluateUrlSafety, highestLevel } from './urlSafety'

describe('evaluateUrlSafety', () => {
  it('returns no issues for benign https URLs', () => {
    expect(evaluateUrlSafety('https://example.com/path')).toEqual([])
  })

  it('warns on punycode hostnames', () => {
    const issues = evaluateUrlSafety('https://xn--pypal-4ve.com/login')
    expect(issues.find(i => i.code === 'punycode')).toBeTruthy()
  })

  it('warns on unicode-mixed hostnames', () => {
    const issues = evaluateUrlSafety('https://例え.com/path')
    // The browser exposes the hostname in ASCII (xn--) so we flag punycode
    // and/or mixed-script. Either is a valid signal.
    expect(issues.some(i => i.code === 'punycode' || i.code === 'mixed-script')).toBe(true)
  })

  it('flags HTTP login pages as dangerous', () => {
    const issues = evaluateUrlSafety('http://example.com/login')
    expect(issues.find(i => i.code === 'http-login')).toBeTruthy()
    expect(highestLevel(issues)).toBe('dangerous')
  })

  it('warns on plain HTTP without login keywords', () => {
    const issues = evaluateUrlSafety('http://example.com/blog')
    expect(issues.find(i => i.code === 'http-only')).toBeTruthy()
    expect(highestLevel(issues)).toBe('warn')
  })

  it('flags uncommon ports', () => {
    const issues = evaluateUrlSafety('https://example.com:3389/rdp')
    expect(issues.find(i => i.code === 'unusual-port')).toBeTruthy()
  })

  it('flags brand impersonators', () => {
    const issues = evaluateUrlSafety('https://paypa1.com/')
    expect(issues.some(i => i.code === 'brand-impersonation')).toBe(true)
    expect(highestLevel(issues)).toBe('dangerous')
  })

  it('returns empty list for unparseable input', () => {
    expect(evaluateUrlSafety('   ')).toEqual([])
  })
})