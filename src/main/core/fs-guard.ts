import fs from 'node:fs'
import path from 'node:path'
import { AppError } from './errors'

export function assertInside(root: string, candidate: string): string {
  const rootResolved = path.resolve(root)
  const candidateResolved = path.resolve(candidate)
  const relative = path.relative(rootResolved, candidateResolved)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return candidateResolved
  }
  throw new AppError('PATH_OUTSIDE_ROOT', 'دسترسی به مسیر خارج از پروژه مجاز نیست.', 403)
}

export function sanitizeSegment(segment: string, fallback = 'item'): string {
  const cleaned = segment
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\.\./g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return cleaned.length > 0 ? cleaned : fallback
}

export function uniquePath(target: string): string {
  if (!fs.existsSync(target)) return target
  const parsed = path.parse(target)
  for (let index = 2; index < 10000; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new AppError('NAME_CONFLICT', 'نام فایل یکتا پیدا نشد.', 409)
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

export function atomicWrite(file: string, content: string | Buffer): void {
  ensureDir(path.dirname(file))
  const temp = `${file}.webforge-${process.pid}-${Date.now()}.tmp`
  fs.writeFileSync(temp, content)
  fs.renameSync(temp, file)
}

export function backupFile(root: string, file: string): string {
  const relative = path.relative(root, file)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = path.join(root, '.webforge', 'backups', stamp, relative)
  ensureDir(path.dirname(backup))
  fs.copyFileSync(file, backup)
  return backup
}

export function isBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 4096)
  for (const byte of sample) {
    if (byte === 0) return true
  }
  return false
}
