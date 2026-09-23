import { describe, expect, it } from 'vitest'
import { redactHeaders, redactLogLine, redactSessionTabs, redactUrl } from './logRedaction'

describe('redactUrl', () => {
  it('returns the input unchanged when no credentials are present', () => {
    expect(redactUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1')
  })

  it('strips userinfo credentials from URLs', () => {
    expect(redactUrl('https://user:pass@example.com/secret')).toBe('https://[REDACTED]@example.com/secret')
  })

  it('redacts well-known token keys from query strings', () => {
    expect(redactUrl('https://x.com/callback?code=abc123&state=ok')).toBe('https://x.com/callback')
    expect(redactUrl('https://x.com/api?token=xyz&page=1')).toBe('https://x.com/api?page=1')
    expect(redactUrl('https://x.com/api?apikey=zz&keep=this')).toBe('https://x.com/api?keep=this')
  })

  it('redacts fragments because OAuth tokens live there', () => {
    expect(redactUrl('https://x.com/cb#access_token=abc&state=ok')).toBe('https://x.com/cb#[REDACTED]')
  })

  it('treats nullish / empty input as empty string', () => {
    expect(redactUrl(null)).toBe('')
    expect(redactUrl(undefined)).toBe('')
    expect(redactUrl('   ')).toBe('')
  })

  it('keeps unrelated query keys intact', () => {
    expect(redactUrl('https://x.com/search?q=hello&page=2')).toBe('https://x.com/search?q=hello&page=2')
  })
})

describe('redactHeaders', () => {
  it('replaces cookie / auth headers with REDACTED', () => {
    const out = redactHeaders({
      cookie: 'session=abc',
      'set-cookie': 'id=1',
      authorization: 'Bearer xyz',
      'content-type': 'application/json',
    })
    expect(out).toEqual({
      cookie: '[REDACTED]',
      'set-cookie': '[REDACTED]',
      authorization: '[REDACTED]',
      'content-type': 'application/json',
    })
  })

  it('returns empty object when input missing', () => {
    expect(redactHeaders(undefined)).toEqual({})
  })
})

describe('redactLogLine', () => {
  it('redacts URLs embedded in free-form log text', () => {
    expect(redactLogLine('GET https://api.example.com?token=abc&page=1 → 200'))
      .toBe('GET https://api.example.com?page=1 → 200')
  })

  it('redacts cookie / authorization header lines', () => {
    const line = 'Cookie: session=abc\nAuthorization: Bearer xyz\nStatus: 200'
    const out = redactLogLine(line)
    expect(out).toContain('Cookie: [REDACTED]')
    expect(out).toContain('Authorization: [REDACTED]')
    expect(out).toContain('Status: 200')
  })

  it('redacts bare token=… substrings even without a URL prefix', () => {
    expect(redactLogLine('emitted token=abcd1234 and apikey=zzz')).toContain('token=[REDACTED]')
    expect(redactLogLine('emitted token=abcd1234 and apikey=zzz')).toContain('apikey=[REDACTED]')
  })

  it('keeps unrelated log substrings intact', () => {
    expect(redactLogLine('GET https://api.example.com/users → 200'))
      .toBe('GET https://api.example.com/users → 200')
  })
})

describe('redactSessionTabs', () => {
  it('strips credentials from each tab url', () => {
    const tabs = [
      { id: 'a', url: 'https://user:pass@example.com' },
      { id: 'b', url: 'https://x.com/?token=zz' },
      { id: 'c' },
    ]
    const out = redactSessionTabs(tabs)
    expect(out[0].url).toBe('https://[REDACTED]@example.com')
    expect(out[1].url).toBe('https://x.com/')
    expect(out[2].url).toBeUndefined()
  })
})