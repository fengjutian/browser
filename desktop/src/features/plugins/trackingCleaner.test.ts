import { describe, expect, it } from 'vitest'
import { cleanTrackingParameters } from './trackingCleaner'

describe('tracking cleaner example plugin', () => {
  it('removes common tracking parameters and keeps useful query data', () => {
    expect(cleanTrackingParameters('https://example.com/article?id=7&utm_source=newsletter&fbclid=abc'))
      .toBe('https://example.com/article?id=7')
  })

  it('leaves non-web and invalid inputs unchanged', () => {
    expect(cleanTrackingParameters('mailto:test@example.com')).toBe('mailto:test@example.com')
    expect(cleanTrackingParameters('not a url')).toBe('not a url')
  })
})
