import { describe, expect, it } from 'vitest'
import { MAX_TAGS, buildAutoTagPrompt, mergeAutoTags, normalizeTag, parseAutoTagResponse } from './autoTag'

describe('autoTag helpers', () => {
  it('reuses the existing vocabulary and prompts up to the max', () => {
    const request = buildAutoTagPrompt({ markdown: 'Body about caching.', existingTags: ['cache', 'database'], title: 'Caching deep dive' }, { maxTags: 4 })
    expect(request.messages[0].content).toContain('Prefer reusing')
    expect(request.messages[1].content).toContain('Existing tag vocabulary: cache, database')
    expect(request.messages[1].content).toContain('up to 4 tags')
  })

  it('normalizes candidate tags to lowercase kebab-case', () => {
    expect(normalizeTag('  Front End  ')).toBe('front-end')
    expect(normalizeTag('WebRTC!!')).toBe('webrtc')
    expect(normalizeTag('')).toBeNull()
    expect(normalizeTag('a'.repeat(40))).toBeNull()
  })

  it('parses a JSON array response and dedupes', () => {
    const tags = parseAutoTagResponse('["Frontend", "frontend", "web-rtc"]', { maxTags: 5 })
    expect(tags).toEqual(['frontend', 'web-rtc'])
  })

  it('falls back to regex extraction when the model wraps the answer in prose', () => {
    const tags = parseAutoTagResponse('Sure, here are the tags: "frontend", "rfc", "browser".')
    expect(tags).toContain('frontend')
    expect(tags).toContain('rfc')
  })

  it('caps the number of tags and drops rejected ones', () => {
    const generated = ['frontend', 'rfc', 'react', 'hooks']
    const merged = mergeAutoTags(['backend'], generated, ['rfc'], { maxTags: 3 })
    expect(merged).toEqual(['frontend', 'react', 'hooks'])
    expect(merged.length).toBeLessThanOrEqual(MAX_TAGS)
    expect(merged).not.toContain('rfc')
  })
})
