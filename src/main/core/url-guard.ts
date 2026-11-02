import dns from 'node:dns/promises'
import net from 'node:net'
import { AppError } from './errors'

const PRIVATE_V4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
] as const

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((part) => Number(part))
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function isPrivateV4(ip: string): boolean {
  const value = ipv4ToInt(ip)
  return PRIVATE_V4.some(([base, bits]) => {
    const mask = (0xffffffff << (32 - bits)) >>> 0
    return (value & mask) === (ipv4ToInt(base) & mask)
  })
}

export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) return isPrivateV4(address)
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase()
    if (normalized === '::' || normalized === '::1') return true
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb'))
      return true
    if (normalized.startsWith('ff')) return true
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateV4(mapped[1])
    return false
  }
  return true
}

export interface SafeUrl {
  url: URL
  addresses: string[]
}

export async function assertPublicUrl(raw: string, allowPrivate = false): Promise<SafeUrl> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new AppError('INVALID_URL', 'آدرس سایت معتبر نیست.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('INVALID_URL', 'آدرس سایت باید با http یا https شروع شود.')
  }
  if (!url.hostname) throw new AppError('INVALID_URL', 'آدرس سایت معتبر نیست.')
  if (url.username || url.password) {
    throw new AppError('URL_HAS_CREDENTIALS', 'آدرس دارای نام کاربری یا رمز عبور است و پذیرفته نمی‌شود.')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (allowPrivate || process.env.WEBFORGE_ALLOW_PRIVATE === '1') return { url, addresses: [hostname] }
  let addresses: string[]
  if (net.isIP(hostname)) {
    addresses = [hostname]
  } else {
    try {
      const records = await dns.lookup(hostname, { all: true, verbatim: true })
      addresses = records.map((record) => record.address)
    } catch {
      throw new AppError('DNS_FAILED', 'آدرس سایت پیدا نشد. اتصال اینترنت یا دامنه را بررسی کن.', 502)
    }
  }
  if (addresses.length === 0) {
    throw new AppError('DNS_FAILED', 'آدرس سایت پیدا نشد.', 502)
  }
  if (addresses.some((address) => isPrivateAddress(address))) {
    throw new AppError('PRIVATE_URL_NOT_ALLOWED', 'این آدرس امن نیست یا به شبکه داخلی اشاره دارد.', 403)
  }
  return { url, addresses }
}

export function sameSite(candidate: URL, base: URL): boolean {
  return candidate.hostname === base.hostname
}
