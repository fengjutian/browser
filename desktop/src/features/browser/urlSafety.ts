/**
 * Lightweight safety heuristics for the URL the address bar is about to
 * navigate to. We deliberately avoid reaching for a third-party IDN library;
 * the warnings are advisory and the Rust navigation layer still rejects
 * unsafe protocols.
 */
export type SafetyLevel = 'safe' | 'warn' | 'dangerous'

export interface SafetyIssue {
  level: SafetyLevel
  code: string
  message: string
}

/** Ports that are commonly abused by phishing kits / trojans. */
const SUSPICIOUS_PORTS = new Set([21, 22, 23, 25, 69, 109, 110, 137, 143, 161, 389, 445, 512, 513, 514, 873, 1080, 1352, 1433, 1521, 1723, 1883, 2049, 2375, 2376, 3306, 3389, 4444, 4848, 5432, 5601, 5900, 5984, 6379, 7001, 8086, 9090, 9200, 9300, 11211, 27017, 50070])

const MIXED_SCRIPT = /[^\x00-\x7F]/.test.bind(/[^\x00-\x7F]/)

/** Common misspellings / lookalikes used in phishing. */
const KEYWORD_BRAND_ALIASES: Record<string, string> = {
  paypa1: 'paypal',
  g00gle: 'google',
  micros0ft: 'microsoft',
  app1e: 'apple',
  arnazon: 'python-cloud',
}

export function evaluateUrlSafety(value: string): SafetyIssue[] {
  const issues: SafetyIssue[] = []
  if (!value) return issues
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
  } catch {
    return issues
  }
  const host = url.hostname
  if (!host) return issues
  if (host.startsWith('xn--') || host.includes('.xn--')) {
    issues.push({ level: 'warn', code: 'punycode', message: '域名使用 punycode 编码（xn--），可能被用于伪装。' })
  }
  // A punycode label or unicode-mixed label
  if (/[^\x00-\x7F]/.test(host)) {
    issues.push({ level: 'warn', code: 'mixed-script', message: '域名含有非 ASCII 字符，请确认是目标站点。' })
  }
  if (url.protocol === 'http:') {
    const path = url.pathname.toLowerCase()
    if (/login|signin|account|payment|pay\b|bank/.test(path)) {
      issues.push({ level: 'dangerous', code: 'http-login', message: 'HTTP 页面包含登录或支付路径，建议改用 HTTPS。' })
    } else {
      issues.push({ level: 'warn', code: 'http-only', message: '未加密连接，传输内容可能被窃听。' })
    }
  }
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80)
  if (port && SUSPICIOUS_PORTS.has(port)) {
    issues.push({ level: 'warn', code: 'unusual-port', message: `端口 ${port} 较少见于浏览器访问，请确认是否为预期的内网服务。` })
  }
  const bare = host.split('.')[0].toLowerCase()
  const alias = KEYWORD_BRAND_ALIASES[bare]
  if (alias) {
    issues.push({ level: 'dangerous', code: 'brand-impersonation', message: `域名「${host}」与「${alias}」形似，可能为钓鱼仿冒。` })
  }
  return issues
}

export function highestLevel(issues: SafetyIssue[]): SafetyLevel {
  if (issues.some(issue => issue.level === 'dangerous')) return 'dangerous'
  if (issues.some(issue => issue.level === 'warn')) return 'warn'
  return 'safe'
}