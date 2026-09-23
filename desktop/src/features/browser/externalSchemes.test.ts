import { describe, expect, it } from 'vitest'
import { classifyShellOpenUrl, describeScheme, schemeOf, SHELL_OPENABLE_SCHEMES } from './externalSchemes'

describe('schemeOf', () => {
  it('extracts a lowercased scheme', () => {
    expect(schemeOf('https://x.com')).toBe('https:')
    expect(schemeOf('MAILTO:a@b.com')).toBe('mailto:')
    expect(schemeOf('vscode://file/path')).toBe('vscode:')
  })
  it('returns null for empty / non-scheme strings', () => {
    expect(schemeOf(null)).toBeNull()
    expect(schemeOf('')).toBeNull()
    expect(schemeOf('foo bar')).toBeNull()
    expect(schemeOf('://nope')).toBeNull()
  })
})

describe('classifyShellOpenUrl', () => {
  it('flags http/https as in-app', () => {
    expect(classifyShellOpenUrl('https://example.com/path')).toEqual({
      inApp: true, shellOpenable: false, irreversible: false, scheme: 'https:',
    })
  })

  it('flags shell-handled schemes as shell-openable', () => {
    for (const scheme of SHELL_OPENABLE_SCHEMES) {
      const result = classifyShellOpenUrl(`${scheme}rest`)
      expect(result.shellOpenable).toBe(true)
      expect(result.irreversible).toBe(false)
    }
  })

  it('blocks dangerous schemes even with a confirmation', () => {
    for (const url of ['javascript:alert(1)', 'data:text/plain;base64,abc', 'vbscript:msgbox(1)', 'file:///c:/x']) {
      const result = classifyShellOpenUrl(url)
      expect(result.shellOpenable).toBe(false)
      expect(result.irreversible).toBe(true)
    }
  })

  it('blocks unknown custom schemes to avoid surprise launches', () => {
    const result = classifyShellOpenUrl('madeup://anything')
    expect(result.shellOpenable).toBe(false)
    expect(result.irreversible).toBe(true)
  })
})

describe('describeScheme', () => {
  it('returns friendly labels for known schemes', () => {
    expect(describeScheme('vscode:')).toBe('Visual Studio Code')
    expect(describeScheme('mailto:')).toBe('邮件应用')
  })

  it('falls back to the raw scheme when unknown', () => {
    expect(describeScheme('mystery:')).toBe('外部应用 (mystery:)')
    expect(describeScheme(null)).toBe('外部应用')
  })
})