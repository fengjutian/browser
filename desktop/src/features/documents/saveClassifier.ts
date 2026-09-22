/**
 * Classify an error thrown during `BrowserPage.save()` into the three known
 * failure modes. Extracted so the regression from P0.1 (no-content save must
 * surface a distinct user-visible error) can be unit-tested without rendering
 * the React tree.
 */
export type SaveErrorKind = 'reader_content_not_found' | 'processing_failed' | 'backend_unavailable'

export function classifySaveError(error: unknown): SaveErrorKind {
  if (error instanceof Error && error.message === 'reader_content_not_found') {
    return 'reader_content_not_found'
  }
  if (error instanceof Error && error.message === 'processing failed') {
    return 'processing_failed'
  }
  return 'backend_unavailable'
}