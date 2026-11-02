import { app, safeStorage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type { AppSettings, SettingsPatch } from '@shared/types'
import type { Database } from '../core/db'
import type { Logger } from '../core/logger'
import { AppError } from '../core/errors'

const KEY_API = 'secret.deepseekApiKey'

export class SettingsService {
  private readonly db: Database
  private readonly logger: Logger
  private readonly defaults: AppSettings

  constructor(db: Database, logger: Logger) {
    this.db = db
    this.logger = logger
    this.defaults = {
      theme: 'dark',
      projectsDir: process.env.WEBFORGE_PROJECTS_DIR || path.join(app.getPath('documents'), 'WebForge Projects'),
      pluginDir: path.join(app.getPath('userData'), 'plugins'),
      portStart: 5173,
      portEnd: 5273,
      aiBaseUrl: 'https://api.deepseek.com',
      aiModel: 'deepseek-flash',
      aiKeyConfigured: false,
      extraction: {
        maxFiles: 500,
        maxBytesMb: 300,
        maxDepth: 2,
        timeoutSeconds: 180,
        concurrency: 4
      }
    }
  }

  private readValue<T>(key: string, fallback: T): T {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)
    if (!row) return fallback
    try {
      return JSON.parse(row.value) as T
    } catch {
      return fallback
    }
  }

  private writeValue(key: string, value: unknown): void {
    this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      JSON.stringify(value),
      new Date().toISOString()
    )
  }

  get(): AppSettings {
    const stored = this.readValue<Partial<AppSettings>>('app.settings', {})
    return {
      ...this.defaults,
      ...stored,
      extraction: { ...this.defaults.extraction, ...(stored.extraction ?? {}) },
      aiKeyConfigured: this.hasApiKey()
    }
  }

  update(patch: SettingsPatch): AppSettings {
    const current = this.get()
    const next: AppSettings = {
      ...current,
      ...('theme' in patch && patch.theme ? { theme: patch.theme } : {}),
      ...('projectsDir' in patch && patch.projectsDir ? { projectsDir: patch.projectsDir } : {}),
      ...('pluginDir' in patch && patch.pluginDir ? { pluginDir: patch.pluginDir } : {}),
      ...('portStart' in patch && patch.portStart ? { portStart: patch.portStart } : {}),
      ...('portEnd' in patch && patch.portEnd ? { portEnd: patch.portEnd } : {}),
      ...('aiBaseUrl' in patch && patch.aiBaseUrl ? { aiBaseUrl: patch.aiBaseUrl.replace(/\/$/, '') } : {}),
      ...('aiModel' in patch && patch.aiModel ? { aiModel: patch.aiModel } : {}),
      extraction: { ...current.extraction, ...(patch.extraction ?? {}) }
    }
    if (next.portStart > next.portEnd) {
      throw new AppError('INVALID_PORT_RANGE', 'بازهٔ پورت نامعتبر است.')
    }
    if (patch.aiKey !== undefined) {
      this.setApiKey(patch.aiKey)
    }
    this.writeValue('app.settings', {
      theme: next.theme,
      projectsDir: next.projectsDir,
      pluginDir: next.pluginDir,
      portStart: next.portStart,
      portEnd: next.portEnd,
      aiBaseUrl: next.aiBaseUrl,
      aiModel: next.aiModel,
      extraction: next.extraction
    })
    fs.mkdirSync(next.projectsDir, { recursive: true })
    fs.mkdirSync(next.pluginDir, { recursive: true })
    this.logger.info('SETTINGS_UPDATED', 'تنظیمات به‌روزرسانی شد.', { theme: next.theme })
    return this.get()
  }

  setApiKey(key: string): void {
    const trimmed = key.trim()
    if (!trimmed) {
      this.db.run('DELETE FROM settings WHERE key = ?', KEY_API)
      return
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new AppError(
        'KEYCHAIN_UNAVAILABLE',
        'ذخیرهٔ امن کلید در این سیستم در دسترس نیست. کلید را در متغیر محیطی DEEPSEEK_API_KEY قرار بده.'
      )
    }
    const encrypted = safeStorage.encryptString(trimmed).toString('base64')
    this.writeValue(KEY_API, { encrypted, scheme: 'safeStorage' })
    this.logger.info('AI_KEY_SAVED', 'کلید هوش مصنوعی به‌صورت رمزنگاری‌شده ذخیره شد.')
  }

  hasApiKey(): boolean {
    if (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim()) return true
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', KEY_API)
    return Boolean(row)
  }

  getApiKey(): string | null {
    const envKey = process.env.DEEPSEEK_API_KEY?.trim()
    if (envKey) return envKey
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', KEY_API)
    if (!row) return null
    try {
      const parsed = JSON.parse(row.value) as { encrypted: string }
      if (!safeStorage.isEncryptionAvailable()) return null
      return safeStorage.decryptString(Buffer.from(parsed.encrypted, 'base64'))
    } catch {
      this.logger.warn('AI_KEY_DECRYPT_FAILED', 'خواندن کلید هوش مصنوعی ناموفق بود.')
      return null
    }
  }

  exportAll(): Record<string, unknown> {
    return {
      settings: this.get(),
      note: 'کلید API هرگز در خروجی قرار نمی‌گیرد.'
    }
  }

  clearAll(): void {
    this.db.run('DELETE FROM settings')
  }
}
