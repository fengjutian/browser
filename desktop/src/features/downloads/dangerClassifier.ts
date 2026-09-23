import type { DangerType } from '../../services/downloads'

/**
 * Pure classifier: maps a download's filename / mime / first bytes into a
 * coarse danger bucket the UI surfaces and the Rust `downloads` table
 * persists. Keep the heuristic **safe by default** — anything we cannot
 * recognise is `document` rather than `none` so the user sees a warning.
 *
 * Categories (intentionally aligned with `DangerType` in services/downloads.ts):
 *   - executable: native binaries (.exe/.msi/.dmg/.apk/.app/.bat/.cmd/.scr)
 *   - script:     JavaScript / shell / batch scripts (.js/.ts/.sh/.ps1/.vbs)
 *   - archive:    archives that frequently carry payloads (.zip/.rar/.7z/.iso)
 *   - document:   anything else (pdf, office, txt, media)
 *   - other:      truly unknown
 *   - none:       only used when the caller has explicitly verified safe
 */

const EXECUTABLE_EXTENSIONS = new Set([
  'exe', 'msi', 'dmg', 'app', 'apk', 'aab', 'ipa', 'pkg', 'deb', 'rpm',
  'bat', 'cmd', 'scr', 'pif', 'com', 'gadget', 'jar', 'jnlp', 'wsf', 'cpl',
])

const SCRIPT_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'sh', 'bash', 'zsh', 'ksh',
  'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'wsf', 'wsh', 'lua', 'pl', 'py',
  'rb', 'php', 'asp', 'aspx', 'jsp', 'hta',
])

const ARCHIVE_EXTENSIONS = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'iso', 'img',
  'dmg', 'ace', 'arj', 'cab', 'lz', 'lzma', 'z', 'war', 'ear',
])

const SCRIPT_MIME_TYPES = new Set([
  'application/javascript', 'text/javascript', 'application/ecmascript',
  'application/x-javascript', 'application/x-shellscript', 'text/x-shellscript',
  'application/x-sh', 'application/x-bash', 'application/x-python',
  'application/x-perl', 'application/x-ruby', 'text/x-python', 'text/x-php',
  'application/x-msdownload', 'application/x-msdos-program',
  'application/x-dosexec', 'application/x-msi',
])

const ARCHIVE_MIME_TYPES = new Set([
  'application/zip', 'application/x-zip-compressed', 'application/x-7z-compressed',
  'application/x-rar-compressed', 'application/x-tar', 'application/gzip',
  'application/x-gzip', 'application/x-bzip2', 'application/x-xz',
  'application/x-iso9660-image', 'application/vnd.android.package-archive',
  'application/x-apple-diskimage', 'application/java-archive',
])

const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf', 'text/plain', 'text/html', 'text/markdown', 'text/csv',
  'application/json', 'application/xml', 'text/xml',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/flac',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
])

function extensionOf(filename: string | undefined): string {
  if (!filename) return ''
  const cleaned = filename.split(/[\\/]/).pop() ?? filename
  const dot = cleaned.lastIndexOf('.')
  if (dot < 0 || dot === cleaned.length - 1) return ''
  return cleaned.slice(dot + 1).toLowerCase()
}

function detectByMagic(head: Uint8Array | undefined): 'executable' | 'script' | 'archive' | 'document' | null {
  if (!head || head.length < 3) return null
  // ZIP / PKG / OOXML: PK\x03\x04
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'archive'
  // RAR: Rar!\x1a\x07
  if (head[0] === 0x52 && head[1] === 0x61 && head[2] === 0x72 && head[3] === 0x21) return 'archive'
  // 7z: 7z\xbc\xaf\x27\x1c
  if (head[0] === 0x37 && head[1] === 0x7a && head[2] === 0xbc && head[3] === 0xaf) return 'archive'
  // gzip: 1f 8b
  if (head[0] === 0x1f && head[1] === 0x8b) return 'archive'
  // bzip2: BZ (42 5a)
  if (head[0] === 0x42 && head[1] === 0x5a && head[2] === 0x68) return 'archive'
  // xz: fd 37 7a 58 5a 00
  if (head.length >= 6 && head[0] === 0xfd && head[1] === 0x37 && head[2] === 0x7a && head[3] === 0x58 && head[4] === 0x5a && head[5] === 0x00) return 'archive'
  // PE / MZ executable: MZ (4D 5A)
  if (head[0] === 0x4d && head[1] === 0x5a) return 'executable'
  // ELF executable: 7f 45 4c 46
  if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return 'executable'
  // Mach-O: feedface / feedfacf / cefaedfe / cffaedfe
  if (head[0] === 0xfe && head[1] === 0xed && head[2] === 0xfa && (head[3] === 0xce || head[3] === 0xcf)) return 'executable'
  if (head[0] === 0xce && head[1] === 0xfa && head[2] === 0xed && head[3] === 0xfe) return 'executable'
  // Android APK / JAR: same as ZIP, already handled above.
  // PDF: %PDF
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'document'
  // Scripts / text: shebang
  if (head[0] === 0x23 && head[1] === 0x21) return 'script'
  return null
}

export interface ClassifyDownloadInput {
  fileName?: string
  mimeType?: string
  /** Optional first N bytes of the response, used when filename is generic. */
  head?: Uint8Array
}

export function classifyDownload(input: ClassifyDownloadInput): DangerType {
  const ext = extensionOf(input.fileName)
  const mime = (input.mimeType ?? '').toLowerCase().split(';')[0].trim()

  if (ext && EXECUTABLE_EXTENSIONS.has(ext)) return 'executable'
  if (ext && SCRIPT_EXTENSIONS.has(ext)) return 'script'
  if (ext && ARCHIVE_EXTENSIONS.has(ext)) return 'archive'

  if (mime && (mime === 'application/x-msdownload' || mime === 'application/x-msdos-program' || mime === 'application/x-dosexec')) {
    return 'executable'
  }
  if (mime && SCRIPT_MIME_TYPES.has(mime)) return 'script'
  if (mime && ARCHIVE_MIME_TYPES.has(mime)) return 'archive'
  if (mime && DOCUMENT_MIME_TYPES.has(mime)) return 'document'

  const magic = detectByMagic(input.head)
  if (magic) return magic

  // Fallback: we have a filename without an extension we recognise — treat as
  // document so the UI gets a neutral tag instead of an alarming "executable".
  if (ext) return 'document'
  return 'other'
}