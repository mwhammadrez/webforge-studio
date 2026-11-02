import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  at: string
  level: LogLevel
  code: string
  message: string
  correlationId: string
  data?: Record<string, unknown>
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(sk-[A-Za-z0-9_-]{8,})/g, '[REDACTED_KEY]'],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]'],
  [/(api[_-]?key["'\s:=]+)[^\s"',}]+/gi, '$1[REDACTED]'],
  [/(token["'\s:=]+)[^\s"',}]+/gi, '$1[REDACTED]'],
  [/(password["'\s:=]+)[^\s"',}]+/gi, '$1[REDACTED]'],
  [/(cookie["'\s:=]+)[^\n]+/gi, '$1[REDACTED]']
]

export function redact(value: unknown): string {
  let text: string
  if (typeof value === 'string') text = value
  else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }
  let output = text
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement)
  }
  return output
}

export class Logger {
  private readonly dir: string
  private readonly file: string
  private readonly recent: LogEntry[] = []

  constructor(userDataDir: string) {
    this.dir = path.join(userDataDir, 'logs')
    fs.mkdirSync(this.dir, { recursive: true })
    const day = new Date().toISOString().slice(0, 10)
    this.file = path.join(this.dir, `${day}.jsonl`)
  }

  get logsDir(): string {
    return this.dir
  }

  log(level: LogLevel, code: string, message: string, data?: Record<string, unknown>, correlationId?: string): LogEntry {
    let safeData: Record<string, unknown> | undefined
    if (data) {
      const redacted = redact(data)
      try {
        safeData = JSON.parse(redacted) as Record<string, unknown>
      } catch {
        safeData = { raw: redacted }
      }
    }
    const entry: LogEntry = {
      at: new Date().toISOString(),
      level,
      code,
      message: redact(message),
      correlationId: correlationId ?? randomUUID(),
      data: safeData
    }
    try {
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, 'utf8')
    } catch {
      // Logging must never bring down the application.
    }
    this.recent.push(entry)
    if (this.recent.length > 300) this.recent.shift()
    if (!process.env.WEBFORGE_QUIET) {
      const line = `[${entry.level}] ${entry.code} ${entry.message}`
      if (level === 'error') console.error(line)
      else if (level === 'warn') console.warn(line)
      else console.log(line)
    }
    return entry
  }

  debug(code: string, message: string, data?: Record<string, unknown>, correlationId?: string): LogEntry {
    return this.log('debug', code, message, data, correlationId)
  }

  info(code: string, message: string, data?: Record<string, unknown>, correlationId?: string): LogEntry {
    return this.log('info', code, message, data, correlationId)
  }

  warn(code: string, message: string, data?: Record<string, unknown>, correlationId?: string): LogEntry {
    return this.log('warn', code, message, data, correlationId)
  }

  error(code: string, message: string, data?: Record<string, unknown>, correlationId?: string): LogEntry {
    return this.log('error', code, message, data, correlationId)
  }

  recentErrors(limit = 20): Array<{ at: string; code: string; message: string }> {
    return this.recent
      .filter((entry) => entry.level === 'error')
      .slice(-limit)
      .reverse()
      .map(({ at, code, message }) => ({ at, code, message }))
  }
}
