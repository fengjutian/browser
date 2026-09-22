import { describe, expect, it } from 'vitest'
import { classifySaveError } from './saveClassifier'

describe('classifySaveError', () => {
  it('returns reader_content_not_found for the matching Error message', () => {
    expect(classifySaveError(new Error('reader_content_not_found'))).toBe('reader_content_not_found')
  })

  it('returns processing_failed for the matching Error message', () => {
    expect(classifySaveError(new Error('processing failed'))).toBe('processing_failed')
  })

  it('returns backend_unavailable for any other Error', () => {
    expect(classifySaveError(new Error('something exploded'))).toBe('backend_unavailable')
    expect(classifySaveError(new Error('Database is locked'))).toBe('backend_unavailable')
  })

  it('returns backend_unavailable for non-Error throwables', () => {
    expect(classifySaveError('reader_content_not_found')).toBe('backend_unavailable')
    expect(classifySaveError({ message: 'reader_content_not_found' })).toBe('backend_unavailable')
    expect(classifySaveError(null)).toBe('backend_unavailable')
    expect(classifySaveError(undefined)).toBe('backend_unavailable')
    expect(classifySaveError(42)).toBe('backend_unavailable')
  })
})