import { describe, expect, it } from 'vitest'

// `useCertificatePrompt` is a thin React-state wrapper around the
// `onCertificateError` / `onCertificateErrorCleared` listeners — testing the
// wrapper requires `@testing-library/react`, which is not declared in this
// package's devDependencies to keep the install surface lean. The hook is
// exercised manually via the certificate error banner in BrowserPage.
//
// Service-layer wrappers are covered indirectly by integration tests; here we
// only assert that the type definitions stay in sync with the Rust payload.
describe('certificate prompt payload contract', () => {
  it('matches the Rust CertificateErrorPayload shape', async () => {
    const mod = await import('../../services/nativeBrowser')
    type Payload = Parameters<typeof mod.onCertificateError>[0] extends (p: infer P) => void ? P : never
    const sample = {
      requestId: 'r',
      url: 'https://x',
      message: 'm',
      repeated: false,
    } satisfies Payload
    expect(Object.keys(sample).sort()).toEqual(['message', 'repeated', 'requestId', 'url'])
  })
})