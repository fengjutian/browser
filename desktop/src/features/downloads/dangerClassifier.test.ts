import { describe, expect, it } from 'vitest'
import { classifyDownload } from './dangerClassifier'

describe('classifyDownload', () => {
  it('classifies known executable extensions', () => {
    expect(classifyDownload({ fileName: 'setup.exe' })).toBe('executable')
    expect(classifyDownload({ fileName: 'Installer.msi' })).toBe('executable')
    expect(classifyDownload({ fileName: 'tool.dmg' })).toBe('executable')
    expect(classifyDownload({ fileName: 'app.apk' })).toBe('executable')
    expect(classifyDownload({ fileName: 'install.pkg' })).toBe('executable')
    expect(classifyDownload({ fileName: 'script.bat' })).toBe('executable')
  })

  it('classifies script extensions before generic fallback', () => {
    expect(classifyDownload({ fileName: 'page.js' })).toBe('script')
    expect(classifyDownload({ fileName: 'build.ts' })).toBe('script')
    expect(classifyDownload({ fileName: 'deploy.sh' })).toBe('script')
    expect(classifyDownload({ fileName: 'setup.ps1' })).toBe('script')
  })

  it('classifies archive extensions', () => {
    expect(classifyDownload({ fileName: 'dataset.zip' })).toBe('archive')
    expect(classifyDownload({ fileName: 'release.tar.gz' })).toBe('archive')
    expect(classifyDownload({ fileName: 'disc.iso' })).toBe('archive')
  })

  it('falls back to magic byte detection when extension is unknown', () => {
    const zipHead = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14])
    expect(classifyDownload({ fileName: 'unknown', head: zipHead })).toBe('archive')
    const mzHead = new Uint8Array([0x4d, 0x5a, 0x90, 0x00])
    expect(classifyDownload({ fileName: 'unknown', head: mzHead })).toBe('executable')
    const pdfHead = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])
    expect(classifyDownload({ fileName: 'unknown', head: pdfHead })).toBe('document')
  })

  it('honours mime hints even without extension', () => {
    expect(classifyDownload({ fileName: 'no-ext', mimeType: 'application/zip' })).toBe('archive')
    expect(classifyDownload({ fileName: 'no-ext', mimeType: 'application/javascript' })).toBe('script')
    expect(classifyDownload({ fileName: 'no-ext', mimeType: 'application/x-msdownload' })).toBe('executable')
    expect(classifyDownload({ fileName: 'no-ext', mimeType: 'application/pdf' })).toBe('document')
  })

  it('returns "other" only when filename and mime are both missing', () => {
    expect(classifyDownload({})).toBe('other')
  })

  it('treats unknown extension as document', () => {
    expect(classifyDownload({ fileName: 'report.bin' })).toBe('document')
    expect(classifyDownload({ fileName: 'manual.zzzunknown' })).toBe('document')
  })

  it('returns "other" when filename has no extension at all', () => {
    expect(classifyDownload({ fileName: 'manual' })).toBe('other')
  })

  it('strips query/fragment from mime before matching', () => {
    expect(classifyDownload({ mimeType: 'application/zip; charset=binary' })).toBe('archive')
  })
})