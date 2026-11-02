import type { GithubRepoDetail, GithubRepoSummary } from '@shared/types'
import type { Logger } from '../core/logger'
import { AppError } from '../core/errors'

interface GithubSearchItem {
  id: number
  full_name: string
  name: string
  owner: { login: string }
  description: string | null
  stargazers_count: number
  forks_count: number
  language: string | null
  license: { spdx_id?: string; name?: string } | null
  archived: boolean
  pushed_at: string
  open_issues_count: number
  html_url: string
  topics?: string[]
  default_branch?: string
  size?: number
  homepage?: string | null
}

interface SearchResponse {
  total_count: number
  incomplete_results: boolean
  items: GithubSearchItem[]
}

const CACHE_TTL = 10 * 60 * 1000
const cache = new Map<string, { at: number; value: unknown }>()

export class DiscoveryService {
  private readonly logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
  }

  async search(query: string, page: number, sort: 'stars' | 'updated' | 'best-match'): Promise<{ total: number; items: GithubRepoSummary[] }> {
    const normalized = query.trim()
    if (normalized.length < 2) throw new AppError('INVALID_QUERY', 'عبارت جستجو خیلی کوتاه است.')
    const params = new URLSearchParams({
      q: normalized,
      per_page: '20',
      page: String(page),
      order: 'desc'
    })
    if (sort === 'stars') params.set('sort', 'stars')
    if (sort === 'updated') params.set('sort', 'updated')
    const key = `search:${params.toString()}`
    const data = await this.request<SearchResponse>(`https://api.github.com/search/repositories?${params.toString()}`, key)
    return {
      total: data.total_count,
      items: data.items.map((item) => this.summarize(item))
    }
  }

  async repo(fullName: string): Promise<GithubRepoDetail> {
    const key = `repo:${fullName}`
    const item = await this.request<GithubSearchItem>(`https://api.github.com/repos/${fullName}`, key)
    const readme = await this.readme(fullName)
    const summary = this.summarize(item)
    return {
      ...summary,
      readme: readme.slice(0, 120_000),
      defaultBranch: item.default_branch ?? 'main',
      sizeKb: item.size ?? 0,
      homepage: item.homepage ?? null,
      compatibility: compatibilityOf(item)
    }
  }

  private async readme(fullName: string): Promise<string> {
    try {
      const response = await fetch(`https://api.github.com/repos/${fullName}/readme`, {
        headers: this.headers('application/vnd.github.raw+json'),
        signal: AbortSignal.timeout(20_000)
      })
      if (!response.ok) return ''
      return await response.text()
    } catch {
      return ''
    }
  }

  private async request<T>(url: string, cacheKey: string): Promise<T> {
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.at < CACHE_TTL) return cached.value as T
    let response: Response
    try {
      response = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(20_000) })
    } catch {
      throw new AppError('GITHUB_UNREACHABLE', 'اتصال به GitHub برقرار نشد. اینترنت را بررسی کن.', 502)
    }
    if (response.status === 403 || response.status === 429) {
      throw new AppError(
        'GITHUB_RATE_LIMIT',
        'سهمیهٔ درخواست GitHub تمام شده است. چند دقیقه بعد دوباره تلاش کن یا در تنظیمات توکن GitHub را وارد کن.',
        429
      )
    }
    if (!response.ok) {
      throw new AppError('GITHUB_ERROR', `GitHub با کد ${response.status} پاسخ داد.`, response.status)
    }
    const data = (await response.json()) as T
    cache.set(cacheKey, { at: Date.now(), value: data })
    this.logger.info('GITHUB_REQUEST', 'درخواست GitHub انجام شد.', { url })
    return data
  }

  private headers(accept = 'application/vnd.github+json'): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept,
      'User-Agent': 'WebForgeStudio/1.0',
      'X-GitHub-Api-Version': '2022-11-28'
    }
    const token = process.env.GITHUB_TOKEN?.trim()
    if (token) headers.Authorization = `Bearer ${token}`
    return headers
  }

  private summarize(item: GithubSearchItem): GithubRepoSummary {
    const reasons: string[] = []
    let level: 'low' | 'medium' | 'high' = 'low'
    const license = item.license?.spdx_id ?? null
    const pushed = new Date(item.pushed_at).getTime()
    const ageDays = Math.round((Date.now() - pushed) / 86_400_000)
    if (!license || license === 'NOASSERTION') {
      level = 'high'
      reasons.push('مجوز مشخص و آزاد ندارد.')
    } else if (!['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MPL-2.0', '0BSD', 'CC0-1.0'].includes(license)) {
      level = 'medium'
      reasons.push(`مجوز ${license} محدودیت دارد؛ قبل از استفاده بررسی کن.`)
    }
    if (item.archived) {
      level = 'high'
      reasons.push('مخزن آرشیو شده و نگهداری نمی‌شود.')
    }
    if (ageDays > 540) {
      level = level === 'high' ? 'high' : 'medium'
      reasons.push(`آخرین فعالیت ${ageDays} روز پیش بوده است.`)
    }
    if (item.stargazers_count < 30) {
      level = level === 'low' ? 'medium' : level
      reasons.push('ستارهٔ کم؛ پروژه تازه یا کم‌کاربرد است.')
    }
    if (item.open_issues_count > 500) {
      level = level === 'low' ? 'medium' : level
      reasons.push('تعداد مسائل باز بالاست.')
    }
    return {
      id: item.id,
      fullName: item.full_name,
      owner: item.owner.login,
      name: item.name,
      description: item.description ?? 'بدون توضیح',
      stars: item.stargazers_count,
      forks: item.forks_count,
      language: item.language,
      license,
      archived: item.archived,
      pushedAt: item.pushed_at,
      openIssues: item.open_issues_count,
      htmlUrl: item.html_url,
      topics: item.topics ?? [],
      risk: { level, reasons }
    }
  }
}

function compatibilityOf(item: GithubSearchItem): string {
  const text = `${item.description ?? ''} ${(item.topics ?? []).join(' ')} ${item.language ?? ''}`.toLowerCase()
  if (/electron|desktop/.test(text)) return 'مناسب اجرای دسکتاپ؛ احتمال نیاز به بسته‌بندی جداگانه.'
  if (/cli|command-line|binary/.test(text)) return 'ابزار خط فرمان است؛ به‌عنوان پلاگین پردازه‌ای قابل اتصال است.'
  if (/playwright|puppeteer|browser/.test(text)) return 'نیازمند Chromium است؛ می‌توان از Chromium خود Electron استفاده کرد.'
  if (/node|javascript|typescript/.test(text)) return 'اکوسیستم Node؛ اتصال مستقیم یا از طریق npm ممکن است.'
  if (/python/.test(text)) return 'پایتون؛ اجرای آن به نصب پایتون روی سیستم کاربر نیاز دارد.'
  if (/go|rust/.test(text)) return 'باینری بومی؛ برای بسته‌بندی ویندوز باید باینری از پیش ساخته شود.'
  return 'سازگاری نیازمند بررسی دستی README و وابستگی‌هاست.'
}
