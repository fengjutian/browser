import { describe, expect, it } from 'vitest'
import { TRANSLATION_VIEW_LABEL, buildTranslatePrompt, splitForTranslation, translationKey } from './translate'

describe('translate helpers', () => {
  it('chunks long articles at paragraph boundaries', () => {
    const long = Array.from({ length: 600 }, (_, index) => `Paragraph ${index} ${'lorem ipsum '.repeat(40)}`).join('\n\n')
    const chunks = splitForTranslation(long)
    expect(chunks.length).toBeGreaterThan(1)
    chunks.forEach(chunk => expect(chunk.text.length).toBeLessThanOrEqual(7000))
  })

  it('keeps short articles in a single chunk', () => {
    const chunks = splitForTranslation('# Title\n\nA short body.')
    expect(chunks).toEqual([{ index: 0, text: '# Title\n\nA short body.' }])
  })

  it('instructs the model to preserve structure in the prompt', () => {
    const request = buildTranslatePrompt({ markdown: '# H\n\nText', targetLanguage: 'zh-CN', view: 'bilingual' })
    expect(request.messages[0].content).toContain('Preserve the document structure exactly')
    expect(request.messages[1].content).toContain('Target language: zh-CN')
    expect(request.messages[1].content).toContain('bilingual')
  })

  it('produces a stable cache key that depends on view, language, and content hash', () => {
    const a = translationKey({ markdown: 'same', targetLanguage: 'zh-CN', view: 'translation-only' })
    const b = translationKey({ markdown: 'same', targetLanguage: 'zh-CN', view: 'translation-only' })
    const c = translationKey({ markdown: 'same', targetLanguage: 'en', view: 'translation-only' })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('labels each view in Chinese', () => {
    expect(TRANSLATION_VIEW_LABEL['translation-only']).toBe('仅译文')
    expect(TRANSLATION_VIEW_LABEL.bilingual).toBe('中英对照')
  })
})
