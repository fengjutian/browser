/**
 * Pure helpers around URLs that should be opened via the OS shell rather than
 * loaded as a web page (e.g. `vscode://`, `slack://`, `mailto:`). The Rust
 * `shell_open` command refuses any dangerous scheme; the frontend needs to
 * (a) recognise when a URL is a shell-handled custom protocol so it can show
 * a confirmation prompt, and (b) humanise the scheme so the dialog tells the
 * user what app they are about to launch.
 */

/** Schemes the OS knows how to hand off — must be confirmed before launching. */
export const SHELL_OPENABLE_SCHEMES = new Set([
  'mailto:',
  'tel:',
  'sms:',
  'vscode:',
  'vscode-insiders:',
  'slack:',
  'discord:',
  'spotify:',
  'steam:',
  'tg:',
  'whatsapp:',
  'zoommtg:',
  'ms-teams:',
  'xmind:',
  'obsidian:',
  'notion:',
  'figma:',
])

/** Schemes we *never* want to shell-open even with a confirmation prompt. */
export const BLOCKED_SCHEMES = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'about:',
  'ms-appx:',
  'ms-appx-web:',
  'chrome:',
  'chrome-extension:',
])

export function schemeOf(url: string | undefined | null): string | null {
  if (!url) return null
  const match = url.trim().match(/^([a-z][a-z0-9+.-]*:)/i)
  if (!match) return null
  return match[1].toLowerCase()
}

export interface ShellOpenClassification {
  /** URL should be loaded in a tab (http / https). */
  inApp: boolean
  /** URL should be handed to the OS shell — caller must confirm. */
  shellOpenable: boolean
  /** URL is unsafe — caller must not invoke the shell. */
  irreversible: boolean
  /** Lowercased scheme (e.g. "mailto:" / "javascript:"). */
  scheme: string | null
}

export function classifyShellOpenUrl(url: string | undefined | null): ShellOpenClassification {
  const scheme = schemeOf(url)
  if (!scheme) return { inApp: false, shellOpenable: false, irreversible: true, scheme: null }
  if (scheme === 'http:' || scheme === 'https:') return { inApp: true, shellOpenable: false, irreversible: false, scheme }
  if (BLOCKED_SCHEMES.has(scheme)) return { inApp: false, shellOpenable: false, irreversible: true, scheme }
  if (SHELL_OPENABLE_SCHEMES.has(scheme)) return { inApp: false, shellOpenable: true, irreversible: false, scheme }
  // Unknown scheme → treat as blocked to avoid surprising the user.
  return { inApp: false, shellOpenable: false, irreversible: true, scheme }
}

/** Human-friendly label for the scheme, e.g. `vscode:` → "Visual Studio Code". */
export function describeScheme(scheme: string | null): string {
  switch (scheme) {
    case 'mailto:': return '邮件应用'
    case 'tel:': return '电话应用'
    case 'sms:': return '短信应用'
    case 'vscode:': return 'Visual Studio Code'
    case 'vscode-insiders:': return 'VS Code Insiders'
    case 'slack:': return 'Slack'
    case 'discord:': return 'Discord'
    case 'spotify:': return 'Spotify'
    case 'steam:': return 'Steam'
    case 'tg:': return 'Telegram'
    case 'whatsapp:': return 'WhatsApp'
    case 'zoommtg:': return 'Zoom'
    case 'ms-teams:': return 'Microsoft Teams'
    case 'xmind:': return 'XMind'
    case 'obsidian:': return 'Obsidian'
    case 'notion:': return 'Notion'
    case 'figma:': return 'Figma'
    default: return scheme ? `外部应用 (${scheme})` : '外部应用'
  }
}