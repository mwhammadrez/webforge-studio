import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type {
  AiBrief,
  AiGenerateResult,
  AiPlanResult,
  AiProgress,
  AiSitePlan,
  Project,
  ToolAiVerdict
} from '@shared/types'
import type { Logger } from '../core/logger'
import type { ProjectService } from './projects'
import type { SettingsService } from './settings'
import { AppError } from '../core/errors'
import { ensureDir, sanitizeSegment } from '../core/fs-guard'

const aiVerdictSchema = z.object({
  verdict: z.enum(['safe', 'caution', 'unsafe']),
  riskLevel: z.enum(['low', 'medium', 'high']),
  summary: z.string().min(1).max(2000),
  capabilities: z.array(z.string().max(200)).max(20).default([]),
  runnable: z.boolean(),
  runtime: z.enum(['node', 'python', 'binary', 'web', 'unknown']),
  usage: z.string().max(2000).default(''),
  warnings: z.array(z.string().max(300)).max(20).default([]),
  permissions: z.object({ network: z.boolean(), projectWrite: z.boolean() })
})

export const aiPlanSchema = z.object({
  brand: z.object({
    name: z.string().min(1).max(120),
    oneLiner: z.string().min(1).max(300),
    audience: z.string().min(1).max(300),
    tone: z.array(z.string().max(60)).min(1).max(6)
  }),
  design: z.object({
    direction: z.string().min(1).max(500),
    palette: z.object({
      bg: z.string().min(1).max(60),
      fg: z.string().min(1).max(60),
      accent: z.string().min(1).max(60),
      muted: z.string().min(1).max(60),
      surface: z.string().min(1).max(60)
    }),
    typography: z.object({
      display: z.string().min(1).max(120),
      body: z.string().min(1).max(120),
      scale: z.array(z.string().max(80)).min(2).max(8)
    }),
    layout: z.string().min(1).max(500),
    motion: z.string().min(1).max(300)
  }),
  nav: z.array(z.object({ label: z.string().min(1).max(60), href: z.string().min(1).max(200) })).min(1).max(10),
  pages: z
    .array(
      z.object({
        slug: z.string().min(1).max(200),
        title: z.string().min(1).max(120),
        goal: z.string().min(1).max(300),
        sections: z.array(z.object({ type: z.string().min(1).max(60), intent: z.string().min(1).max(300) })).min(1).max(14)
      })
    )
    .min(1)
    .max(12),
  footer: z.object({ columns: z.array(z.string().max(200)).max(4), legal: z.string().max(300) }),
  estimatedRequests: z.number().int().min(1).max(100)
})

const DESIGN_LAWS = `
DESIGN LAWS (non-negotiable):
1. Every visual choice must be grounded in the subject's industry, material, or vernacular — not generic startup aesthetics.
2. Use one type family, at most two. Set a real scale with clamp(); body line length under 80ch.
3. Spend boldness in exactly one place (hero, a color block, one oversized number); everything else stays quiet.
4. Structure must encode information. Numbering only for real sequences, never as decoration.
5. Motion answers an action. No scattered fade-up-on-scroll. Respect prefers-reduced-motion.
6. Real copy in active voice, sentence case. CTA names the outcome, never "Learn more".
7. Tokens only: var(--color-*), var(--space-*), var(--radius-*). No raw hex outside tokens.css.
8. Responsive at 375 / 768 / 1024 / 1440. Visible focus styles. Contrast >= 4.5:1.
9. Semantic landmarks: header/nav/main/footer, exactly one h1 per page, alt text on meaningful images.
10. No layout shift: reserve image dimensions. No JS for layout.

BANNED (AI slop): cream + serif + terracotta; near-black + acid green; identical rounded cards with the same shadow;
ALL-CAPS eyebrow labels; middle-dot meta strings; "WORD — fragment" headline labels; emoji as icons; purple gradients;
Inter as the only idea; glassmorphism everywhere; endless three-column feature grids; fake dashboard screenshots.
`

const SYSTEM_PLAN = `You are a senior design lead and information architect at a studio known for distinctive, useful websites.
You will receive a website brief. Produce a structured site plan as a single JSON object.

Rules:
- The JSON must match the requested shape exactly; no markdown, no prose outside JSON.
- Choose one clear design direction grounded in the subject. Pick a real palette with accessible contrast.
- Palette values must be CSS colors (oklch or hex). Prefer oklch.
- The plan must include between 1 and 8 pages, each with 3 to 8 sections.
- Nav hrefs must correspond to page slugs ("/" for home).
- Write all human-facing copy in the requested language.
- estimatedRequests = number of pages + 2.

Example JSON:
{"brand":{"name":"نمونه","oneLiner":"یک جمله روشن","audience":"مخاطب دقیق","tone":["آرام","دقیق"]},
"design":{"direction":"...","palette":{"bg":"oklch(0.98 0.01 90)","fg":"oklch(0.2 0.02 240)","accent":"oklch(0.55 0.16 30)","muted":"oklch(0.55 0.01 240)","surface":"oklch(0.94 0.01 90)"},
"typography":{"display":"Vazirmatn, system-ui","body":"Vazirmatn, system-ui","scale":["clamp(2.2rem, 5vw, 4.5rem)","clamp(1.4rem, 2.4vw, 2rem)","1rem"]},
"layout":"...","motion":"..."},
"nav":[{"label":"خانه","href":"/"}],
"pages":[{"slug":"/","title":"خانه","goal":"...","sections":[{"type":"hero","intent":"..."},{"type":"features","intent":"..."},{"type":"cta","intent":"..."}]}],
"footer":{"columns":["درباره","تماس"],"legal":"© 2026"},
"estimatedRequests":3}

${DESIGN_LAWS}`

const SYSTEM_PAGE = `You are a senior front-end engineer implementing one page of an approved website plan.
You receive: the site plan JSON, the CSS token inventory, the shared class inventory, and one page brief.
Return ONLY the inner HTML of that page's <main> element. No <html>, <head>, <body>, <style>, <script>, markdown fences, or commentary.
Use semantic HTML5 and only classes from the inventory plus layout utility classes. Use CSS variables for all colors and spacing.
Every image must have alt, width, height. Prefer CSS/SVG decoration over external images. Do not use external fonts or CDNs.
Links must point to the page paths from the plan. Write real copy in the plan's language, never filler text.
${DESIGN_LAWS}`

interface ChatUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export class AiService {
  private readonly settings: SettingsService
  private readonly projects: ProjectService
  private readonly logger: Logger
  private readonly controllers = new Map<string, AbortController>()

  constructor(settings: SettingsService, projects: ProjectService, logger: Logger) {
    this.settings = settings
    this.projects = projects
    this.logger = logger
  }

  async testConnection(): Promise<{ ok: boolean; message: string; models?: string[] }> {
    const settings = this.settings.get()
    const key = this.settings.getApiKey()
    if (!key) return { ok: false, message: 'کلید API تنظیم نشده است.' }
    try {
      const response = await fetch(`${settings.aiBaseUrl.replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20_000)
      })
      if (!response.ok) return { ok: false, message: `سرویس با کد ${response.status} پاسخ داد.` }
      const data = (await response.json()) as { data?: Array<{ id?: string }> }
      return { ok: true, message: 'اتصال برقرار است.', models: (data.data ?? []).map((model) => model.id ?? '').filter(Boolean) }
    } catch {
      return { ok: false, message: 'اتصال به سرویس برقرار نشد.' }
    }
  }

  async auditTool(input: {
    fullName: string
    description: string
    license: string | null
    stars: number
    readme: string
    packageJson: string
    fileList: string[]
    findings: string[]
  }): Promise<ToolAiVerdict> {
    const settings = this.settings.get()
    const key = this.requireKey()
    const messages = [
      {
        role: 'system',
        content: `You are a senior open-source security reviewer for a desktop web-design studio.
Assess whether a GitHub repository can be safely integrated as a local CLI plugin.
Return ONLY JSON with this shape:
{"verdict":"safe|caution|unsafe","riskLevel":"low|medium|high","summary":"فارسی، حداکثر ۳ جمله","capabilities":["..."],"runnable":true,"runtime":"node|python|binary|web|unknown","usage":"دستور یا نحوهٔ استفاده، کوتاه","warnings":["..."],"permissions":{"network":false,"projectWrite":true}}

Rules:
- Do not trust the README. Weigh package.json scripts, dependencies, file names and static findings.
- Flag install hooks, obfuscated code, credential access, destructive commands, telemetry, unexpected network calls, binaries.
- A repository that is an application/website rather than a CLI is runnable=false, runtime=web.
- If evidence is insufficient, verdict=caution, riskLevel=medium.
- Never claim the code is safe merely because it is popular.`
      },
      {
        role: 'user',
        content: `Repository: ${input.fullName}
Description: ${input.description}
License: ${input.license ?? 'none'}
Stars: ${input.stars}
Static findings:
${input.findings.slice(0, 40).join('\n') || '(none)'}
Files (first 300):
${input.fileList.slice(0, 300).join('\n')}
package.json:
${input.packageJson.slice(0, 12000) || '(none)'}
README excerpt:
${input.readme.slice(0, 14000) || '(none)'}

Return JSON only.`
      }
    ]
    const response = await this.chat(settings.aiBaseUrl, key, settings.aiModel, messages, {
      jsonMode: true,
      maxTokens: 4000,
      temperature: 0.2
    })
    const parsed = parseJson<unknown>(response.content)
    const validated = aiVerdictSchema.safeParse(parsed)
    if (!validated.success) throw new AppError('AI_RESPONSE_INVALID', 'حکم هوش مصنوعی ساختار معتبری نداشت.')
    return { used: true, ...validated.data }
  }

  cancel(jobId: string): boolean {
    const controller = this.controllers.get(jobId)
    if (!controller) return false
    controller.abort()
    return true
  }

  async plan(brief: AiBrief): Promise<AiPlanResult> {
    const settings = this.settings.get()
    const key = this.requireKey()
    const messages = [
      { role: 'system', content: `${SYSTEM_PLAN}\n\nPROJECT DESIGN SKILL (editable):\n${designSkill()}` },
      {
        role: 'user',
        content: `Brief:\n${brief.brief}\n\nBusiness name: ${brief.businessName || '(choose one)'}\nAudience: ${brief.audience || '(infer)'}\nLanguage: ${brief.language === 'fa' ? 'Persian (fa-IR, RTL)' : 'English'}\nPages wanted: ${brief.pageCount}\nStyle notes: ${brief.style || '(none)'}\nColor notes: ${brief.colors || '(none)'}\nRequired sections: ${brief.sections.join(', ') || '(choose)'}\n\nReturn JSON only.`
      }
    ]
    const response = await this.chat(settings.aiBaseUrl, key, settings.aiModel, messages, {
      jsonMode: true,
      maxTokens: 8000,
      temperature: 0.6
    })
    const parsed = parseJson<unknown>(response.content)
    const validated = aiPlanSchema.safeParse(parsed)
    if (!validated.success) {
      throw new AppError(
        'AI_RESPONSE_INVALID',
        `پاسخ هوش مصنوعی ساختار معتبری نداشت: ${validated.error.issues.map((issue) => issue.path.join('.')).join(', ')}`
      )
    }
    const plan = validated.data as AiSitePlan
    return {
      plan,
      model: settings.aiModel,
      estimatedRequests: plan.pages.length + 2,
      estimatedCostUsd: estimateCost(response.usage, plan.pages.length)
    }
  }

  async generate(brief: AiBrief, plan: AiSitePlan, jobId: string, onProgress: (progress: AiProgress) => void): Promise<AiGenerateResult> {
    const settings = this.settings.get()
    const key = this.requireKey()
    const controller = new AbortController()
    this.controllers.set(jobId, controller)
    const root = brief.outputRoot ?? settings.projectsDir
    ensureDir(root)
    const folderName = sanitizeSegment(plan.brand.name || brief.businessName || 'site', 'site')
    let project: Project
    try {
      const created = this.projects.createFolder(folderName, root)
      project = this.projects.register({
        name: created.name,
        dir: created.dir,
        type: 'static',
        status: 'ready'
      })
    } catch (error) {
      this.controllers.delete(jobId)
      throw error
    }
    const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    const files: string[] = []
    try {
      onProgress({ stage: 'tokens', current: 0, total: plan.pages.length + 2, message: 'در حال ساخت توکن‌های طراحی…', file: 'tokens.css' })
      const fontSource = findFont()
      if (fontSource) {
        ensureDir(path.join(project.path, 'assets'))
        await fsp.copyFile(fontSource, path.join(project.path, 'assets', 'Vazirmatn.woff2'))
        files.push('assets/Vazirmatn.woff2')
      }
      const css = buildTokensCss(plan, brief, Boolean(fontSource))
      await fsp.writeFile(path.join(project.path, 'tokens.css'), css, 'utf8')
      files.push('tokens.css')

      onProgress({ stage: 'shell', current: 1, total: plan.pages.length + 2, message: 'در حال ساخت پوسته و منو…', file: 'shell' })
      const shell = buildShell(plan, brief)
      const tokens = extractTokenSummary(css)
      const fileBySlug = new Map(plan.pages.map((page) => [page.slug, slugToFile(page.slug)]))

      for (let index = 0; index < plan.pages.length; index += 1) {
        if (controller.signal.aborted) throw new AppError('AI_CANCELLED', 'ساخت سایت لغو شد.')
        const page = plan.pages[index]
        onProgress({
          stage: 'page',
          current: index + 2,
          total: plan.pages.length + 2,
          message: `در حال ساخت صفحهٔ ${page.title}…`,
          file: slugToFile(page.slug)
        })
        const messages = [
          { role: 'system', content: `${SYSTEM_PAGE}\n\nPROJECT DESIGN SKILL (editable):\n${designSkill()}` },
          {
            role: 'user',
            content: `SITE PLAN:\n${JSON.stringify(plan, null, 2)}\n\nTOKENS:\n${tokens}\n\nCLASS INVENTORY:\n${CLASS_INVENTORY}\n\nPAGE BRIEF:\n${JSON.stringify(page, null, 2)}\n\nLanguage: ${brief.language === 'fa' ? 'Persian, dir=rtl' : 'English, dir=ltr'}\nReturn only the <main> inner HTML.`
          }
        ]
        const response = await this.chat(settings.aiBaseUrl, key, settings.aiModel, messages, {
          maxTokens: 16000,
          temperature: 0.7,
          signal: controller.signal,
          stream: true
        })
        usage.promptTokens += response.usage.prompt_tokens ?? 0
        usage.completionTokens += response.usage.completion_tokens ?? 0
        usage.totalTokens += response.usage.total_tokens ?? 0
        const content = normalizePageHtml(response.content, fileBySlug)
        const html = shell
          .replace('<!--PAGE_CONTENT-->', content)
          .replace('<!--PAGE_TITLE-->', escapeHtml(`${page.title} — ${plan.brand.name}`))
          .replace('<!--PAGE_DESC-->', escapeAttr(page.goal || plan.brand.oneLiner))
        const fileName = fileBySlug.get(page.slug) ?? slugToFile(page.slug)
        const target = path.join(project.path, fileName)
        ensureDir(path.dirname(target))
        await fsp.writeFile(target, html, 'utf8')
        files.push(fileName)
        onProgress({
          stage: 'writing',
          current: index + 2,
          total: plan.pages.length + 2,
          message: `صفحهٔ ${page.title} ذخیره شد.`,
          file: fileName
        })
      }

      await writeSupportFiles(project.path, plan, files, brief)
      for (const file of files) {
        if (!fs.existsSync(path.join(project.path, file))) throw new AppError('AI_OUTPUT_MISSING', `فایل ${file} ساخته نشد.`)
      }
      this.projects.touch(project.id)
      onProgress({ stage: 'done', current: plan.pages.length + 2, total: plan.pages.length + 2, message: 'سایت آماده است.', file: null })
      this.logger.info('AI_GENERATION_DONE', 'سایت با هوش مصنوعی ساخته شد.', {
        projectId: project.id,
        pages: plan.pages.length,
        model: settings.aiModel
      })
      return {
        projectId: project.id,
        projectPath: project.path,
        files,
        model: settings.aiModel,
        usage,
        previewUrl: null
      }
    } catch (error) {
      this.logger.error('AI_GENERATION_FAILED', 'ساخت سایت ناموفق بود.', {
        projectId: project.id,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    } finally {
      this.controllers.delete(jobId)
    }
  }

  private requireKey(): string {
    const key = this.settings.getApiKey()
    if (!key) throw new AppError('AI_KEY_MISSING', 'کلید API هوش مصنوعی تنظیم نشده است. آن را در تنظیمات وارد کن.')
    return key
  }

  private async chat(
    baseUrl: string,
    key: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
    options: { jsonMode?: boolean; maxTokens: number; temperature: number; stream?: boolean; signal?: AbortSignal }
  ): Promise<{ content: string; usage: ChatUsage }> {
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      thinking: { type: 'disabled' },
      stream: Boolean(options.stream),
      stream_options: options.stream ? { include_usage: true } : undefined
    }
    if (options.jsonMode) body.response_format = { type: 'json_object' }
    const timeout = AbortSignal.timeout(180_000)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal
      })
    } catch (error) {
      if (options.signal?.aborted) throw new AppError('AI_CANCELLED', 'ساخت سایت لغو شد.')
      throw new AppError('AI_NETWORK', 'اتصال به سرویس هوش مصنوعی برقرار نشد.', 502)
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const code = response.status === 401 ? 'AI_UNAUTHORIZED' : response.status === 402 ? 'AI_BALANCE' : response.status === 429 ? 'AI_RATE_LIMIT' : 'AI_HTTP_ERROR'
      const messagesMap: Record<string, string> = {
        AI_UNAUTHORIZED: 'کلید API پذیرفته نشد. کلید را در تنظیمات بررسی کن.',
        AI_BALANCE: 'اعتبار حساب هوش مصنوعی کافی نیست.',
        AI_RATE_LIMIT: 'سرویس هوش مصنوعی فعلاً محدودیت درخواست دارد. کمی بعد دوباره تلاش کن.',
        AI_HTTP_ERROR: `سرویس هوش مصنوعی خطا داد (${response.status}).`
      }
      this.logger.warn('AI_HTTP', 'پاسخ ناموفق سرویس هوش مصنوعی.', { status: response.status, detail: text.slice(0, 300) })
      throw new AppError(code, messagesMap[code], response.status)
    }
    if (!options.stream) {
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: ChatUsage
      }
      return { content: json.choices?.[0]?.message?.content ?? '', usage: json.usage ?? {} }
    }
    return this.readStream(response)
  }

  private async readStream(response: Response): Promise<{ content: string; usage: ChatUsage }> {
    if (!response.body) throw new AppError('AI_RESPONSE_INVALID', 'پاسخ سرویس هوش مصنوعی بدنه ندارد.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let usage: ChatUsage = {}
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''
      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (!data || data === '[DONE]') continue
          try {
            const chunk = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>
              usage?: ChatUsage
            }
            content += chunk.choices?.[0]?.delta?.content ?? ''
            if (chunk.usage) usage = chunk.usage
          } catch {
            // Keep-alive or partial frame; the next chunk completes it.
          }
        }
      }
    }
    return { content, usage }
  }
}

const CLASS_INVENTORY = `
Layout: .container .section .section--tight .grid .grid--2 .grid--3 .grid--4 .stack .cluster .split
Type: .display .h1 .h2 .h3 .lead .muted .eyebrow .measure
Components: .btn .btn--primary .btn--ghost .card .card--flat .media .tag .stat .stat__value .stat__label
Navigation: .site-header .site-nav .site-nav__link .site-footer .footer-grid .brand
Utility: .mt-0 .mt-2 .mt-4 .mt-6 .mt-8 .flow > * + *
`

function buildTokensCss(plan: AiSitePlan, brief: AiBrief, hasFont: boolean): string {
  const palette = plan.design.palette
  const font = brief.language === 'fa' ? 'Vazirmatn, "Segoe UI", Tahoma, system-ui, sans-serif' : '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif'
  const scale = plan.design.typography.scale
  const fontDisplay = plan.design.typography.display.includes('Vazirmatn') ? font : plan.design.typography.display
  const fontBody = plan.design.typography.body.includes('Vazirmatn') ? font : plan.design.typography.body
  return `/* Design tokens — generated by WebForge Studio */
${hasFont ? `@font-face { font-family: 'Vazirmatn'; src: url('assets/Vazirmatn.woff2') format('woff2-variations'); font-weight: 100 900; font-display: swap; }\n` : ''}:root {
  --color-bg: ${palette.bg};
  --color-fg: ${palette.fg};
  --color-accent: ${palette.accent};
  --color-muted: ${palette.muted};
  --color-surface: ${palette.surface};
  --color-border: color-mix(in oklch, var(--color-fg) 14%, transparent);
  --color-accent-fg: color-mix(in oklch, var(--color-bg) 92%, white);
  --font-display: ${fontDisplay};
  --font-body: ${fontBody};
  --text-xs: 0.78rem;
  --text-sm: 0.9rem;
  --text-base: 1rem;
  --text-lg: ${scale[2] ?? '1.2rem'};
  --text-xl: ${scale[1] ?? '1.6rem'};
  --text-2xl: ${scale[0] ?? 'clamp(2rem, 4vw, 3.4rem)'};
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --space-7: 3rem;
  --space-8: 4.5rem;
  --space-9: 7rem;
  --radius-sm: 0.35rem;
  --radius-md: 0.75rem;
  --radius-lg: 1.4rem;
  --shadow: 0 18px 50px -24px color-mix(in oklch, var(--color-fg) 32%, transparent);
  --measure: 68ch;
  --header-h: 4.25rem;
}

*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-fg);
  font-family: var(--font-body);
  font-size: var(--text-base);
  line-height: 1.7;
  text-rendering: optimizeLegibility;
}
img, svg, video { max-width: 100%; height: auto; display: block; }
a { color: inherit; text-decoration-thickness: 1px; text-underline-offset: 0.18em; }
a:hover { color: var(--color-accent); }
h1, h2, h3, p, figure, blockquote { margin: 0; }
h1, h2, h3 { font-family: var(--font-display); line-height: 1.08; letter-spacing: -0.02em; text-wrap: balance; }
h1 { font-size: var(--text-2xl); }
h2 { font-size: var(--text-xl); }
h3 { font-size: var(--text-lg); }
p { text-wrap: pretty; }
ul, ol { padding-inline-start: 1.2em; }
button, input, textarea, select { font: inherit; color: inherit; }
:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 3px; border-radius: 4px; }
::selection { background: var(--color-accent); color: var(--color-accent-fg); }

.container { width: min(1180px, calc(100% - 2.5rem)); margin-inline: auto; }
.section { padding-block: var(--space-8); }
.section--tight { padding-block: var(--space-6); }
.stack { display: flex; flex-direction: column; gap: var(--space-4); }
.cluster { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
.split { display: grid; gap: var(--space-6); grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); align-items: start; }
.grid { display: grid; gap: var(--space-4); }
.grid--2 { grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr)); }
.grid--3 { grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); }
.grid--4 { grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); }
.mt-0 { margin-block-start: 0; } .mt-2 { margin-block-start: var(--space-2); }
.mt-4 { margin-block-start: var(--space-4); } .mt-6 { margin-block-start: var(--space-6); }
.mt-8 { margin-block-start: var(--space-8); }
.flow > * + * { margin-block-start: var(--space-4); }
.measure { max-width: var(--measure); }
.muted { color: var(--color-muted); }
.eyebrow { font-size: var(--text-xs); font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-accent); }
.lead { font-size: var(--text-lg); color: var(--color-muted); max-width: var(--measure); }
.display { font-family: var(--font-display); font-size: var(--text-2xl); line-height: 1.02; }

.site-header {
  position: sticky; inset-block-start: 0; z-index: 50;
  min-height: var(--header-h);
  background: color-mix(in oklch, var(--color-bg) 88%, transparent);
  backdrop-filter: blur(12px);
  border-block-end: 1px solid var(--color-border);
}
.site-header .container { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); min-height: var(--header-h); }
.brand { display: inline-flex; align-items: center; gap: var(--space-2); font-family: var(--font-display); font-weight: 800; text-decoration: none; }
.brand__mark { width: 1.6rem; height: 1.6rem; border-radius: 0.45rem; background: var(--color-accent); display: grid; place-items: center; color: var(--color-accent-fg); font-size: 0.8rem; }
.site-nav { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
.site-nav__link { text-decoration: none; padding: 0.45rem 0.7rem; border-radius: var(--radius-sm); font-size: var(--text-sm); }
.site-nav__link:hover, .site-nav__link[aria-current="page"] { background: var(--color-surface); color: var(--color-fg); }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; min-height: 2.85rem; padding: 0.6rem 1.15rem; border-radius: var(--radius-sm); border: 1px solid var(--color-border); background: transparent; color: var(--color-fg); font-weight: 650; text-decoration: none; cursor: pointer; transition: transform .16s ease, background .16s ease; }
.btn:hover { transform: translateY(-1px); }
.btn--primary { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
.btn--ghost { background: color-mix(in oklch, var(--color-surface) 75%, transparent); }

.card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-5); }
.card--flat { background: transparent; }
.card h3 { margin-block-end: var(--space-2); }
.media { border-radius: var(--radius-md); overflow: hidden; background: var(--color-surface); border: 1px solid var(--color-border); }
.tag { display: inline-flex; padding: 0.2rem 0.6rem; border: 1px solid var(--color-border); border-radius: 999px; font-size: var(--text-xs); color: var(--color-muted); }
.stat__value { font-family: var(--font-display); font-size: var(--text-xl); font-weight: 800; display: block; }
.stat__label { color: var(--color-muted); font-size: var(--text-sm); }

.site-footer { border-block-start: 1px solid var(--color-border); margin-block-start: var(--space-8); padding-block: var(--space-6); color: var(--color-muted); }
.footer-grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); }
.site-footer a { text-decoration: none; }
.site-footer a:hover { text-decoration: underline; }

.hero { padding-block: var(--space-9) var(--space-8); border-block-end: 1px solid var(--color-border); }
.hero__title { max-width: 16ch; }
.hero__aside { align-self: end; }
.split--hero { align-items: end; }

@media (max-width: 720px) {
  .container { width: min(100% - 1.5rem, 1180px); }
  .section { padding-block: var(--space-6); }
  .hero { padding-block: var(--space-7) var(--space-6); }
  .site-nav { gap: 0; }
  .site-nav__link { padding: 0.35rem 0.5rem; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
}
`
}

function buildShell(plan: AiSitePlan, brief: AiBrief): string {
  const dir = brief.language === 'fa' ? 'rtl' : 'ltr'
  const lang = brief.language === 'fa' ? 'fa' : 'en'
  const nav = plan.nav
    .map((item) => `<a class="site-nav__link" href="${escapeAttr(linkFor(item.href))}">${escapeHtml(item.label)}</a>`)
    .join('\n          ')
  const footerColumns = plan.footer.columns
    .map((column) => `<div><h3>${escapeHtml(column)}</h3><p class="muted">${escapeHtml(plan.brand.oneLiner)}</p></div>`)
    .join('\n        ')
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><!--PAGE_TITLE--></title>
  <meta name="description" content="<!--PAGE_DESC-->">
  <link rel="stylesheet" href="tokens.css">
</head>
<body>
  <a class="btn" href="#main" style="position:absolute;inset-inline-start:-9999px" onfocus="this.style.insetInlineStart='1rem';this.style.top='1rem';this.style.zIndex=100">${brief.language === 'fa' ? 'پرش به محتوا' : 'Skip to content'}</a>
  <header class="site-header">
    <div class="container">
      <a class="brand" href="${escapeAttr(linkFor('/'))}"><span class="brand__mark">${escapeHtml(plan.brand.name.slice(0, 2))}</span><span>${escapeHtml(plan.brand.name)}</span></a>
      <nav class="site-nav" aria-label="${brief.language === 'fa' ? 'منوی اصلی' : 'Main navigation'}">
          ${nav}
      </nav>
    </div>
  </header>
  <!--PAGE_CONTENT-->
  <footer class="site-footer">
    <div class="container footer-grid">
        ${footerColumns}
      <div><h3>${escapeHtml(plan.brand.name)}</h3><p class="muted">${escapeHtml(plan.footer.legal)}</p></div>
    </div>
  </footer>
  <script>
    (function () {
      var path = location.pathname.split('/').pop() || 'index.html';
      document.querySelectorAll('.site-nav__link').forEach(function (link) {
        var href = link.getAttribute('href');
        if (href === path || (path === '' && href === 'index.html')) link.setAttribute('aria-current', 'page');
      });
    })();
  </script>
</body>
</html>
`
}

async function writeSupportFiles(root: string, plan: AiSitePlan, files: string[], brief: AiBrief): Promise<void> {
  const urls = plan.pages.map((page) => `  <url><loc>/${slugToFile(page.slug)}</loc></url>`).join('\n')
  await fsp.writeFile(
    path.join(root, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    'utf8'
  )
  await fsp.writeFile(path.join(root, 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8')
  const notFound = `<!doctype html><html lang="${brief.language}" dir="${brief.language === 'fa' ? 'rtl' : 'ltr'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>404</title><link rel="stylesheet" href="tokens.css"><body><main class="container section stack"><p class="eyebrow">404</p><h1>${brief.language === 'fa' ? 'این صفحه پیدا نشد.' : 'Page not found.'}</h1><p class="lead">${brief.language === 'fa' ? 'به صفحهٔ اصلی برگرد و مسیر دیگری را امتحان کن.' : 'Return to the home page and try another path.'}</p><a class="btn btn--primary" href="index.html">${brief.language === 'fa' ? 'بازگشت به خانه' : 'Back home'}</a></main></body></html>`
  await fsp.writeFile(path.join(root, '404.html'), notFound, 'utf8')
  await fsp.writeFile(
    path.join(root, 'README.md'),
    `# ${plan.brand.name}\n\n${plan.brand.oneLiner}\n\nساخته‌شده با WebForge Studio و مدل هوش مصنوعی.\n\n## صفحات\n${plan.pages.map((page) => `- ${page.title} — \`${slugToFile(page.slug)}\``).join('\n')}\n\n## اجرا\nپوشه را با پیش‌نمایش WebForge باز کن، یا یک سرور استاتیک ساده اجرا کن.\n`,
    'utf8'
  )
  files.push('sitemap.xml', 'robots.txt', '404.html', 'README.md')
}

function slugToFile(slug: string): string {
  const clean = slug.replace(/^\/+|\/+$/g, '')
  if (!clean) return 'index.html'
  if (clean.includes('.')) return clean
  return `${clean.replace(/\//g, '-')}.html`
}

function linkFor(href: string): string {
  if (/^https?:|^mailto:|^tel:|^#/.test(href)) return href
  return slugToFile(href)
}

function normalizePageHtml(content: string, files: Map<string, string>): string {
  let html = content.trim()
  html = html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '')
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
  if (mainMatch) html = mainMatch[1]
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '')
  html = html.replace(/<style[\s\S]*?<\/style>/gi, '')
  html = html.replace(/<html[^>]*>|<\/html>|<head[\s\S]*?<\/head>|<body[^>]*>|<\/body>/gi, '')
  html = html.replace(/href=["']([^"']+)["']/gi, (match, href: string) => {
    const cleaned = href.trim()
    if (files.has(cleaned)) return `href="${files.get(cleaned)}"`
    if (cleaned.startsWith('/') && !cleaned.startsWith('//')) return `href="${linkFor(cleaned)}"`
    return match
  })
  return `<main id="main" class="page">\n${html}\n</main>`
}

function extractTokenSummary(css: string): string {
  return css
    .split('\n')
    .filter((line) => line.trim().startsWith('--'))
    .slice(0, 80)
    .join('\n')
}

function parseJson<T>(content: string): T {
  const trimmed = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1) throw new AppError('AI_RESPONSE_INVALID', 'پاسخ هوش مصنوعی JSON معتبری نداشت.')
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as T
  } catch {
    throw new AppError('AI_RESPONSE_INVALID', 'پاسخ هوش مصنوعی JSON معتبری نداشت.')
  }
}

function estimateCost(usage: ChatUsage, pages: number): number {
  const inputTokens = (usage.prompt_tokens ?? 1800) + pages * 2500
  const outputTokens = (usage.completion_tokens ?? 2200) + pages * 4500
  return Number(((inputTokens / 1_000_000) * 0.3 + (outputTokens / 1_000_000) * 1.2).toFixed(4))
}

function findFont(): string | null {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'resources', 'fonts', 'Vazirmatn.woff2') : '',
    path.join(process.cwd(), 'resources', 'fonts', 'Vazirmatn.woff2'),
    path.join(process.cwd(), 'src', 'renderer', 'src', 'assets', 'Vazirmatn.woff2')
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

let cachedSkill: string | null = null
function designSkill(): string {
  if (cachedSkill !== null) return cachedSkill
  const roots = [
    process.resourcesPath ? path.join(process.resourcesPath, 'resources', 'skills', 'web-design', 'SKILL.md') : '',
    path.join(process.cwd(), 'resources', 'skills', 'web-design', 'SKILL.md')
  ].filter(Boolean)
  for (const candidate of roots) {
    try {
      if (fs.existsSync(candidate)) {
        cachedSkill = fs.readFileSync(candidate, 'utf8').slice(0, 16000)
        return cachedSkill
      }
    } catch {
      // Fall through to the embedded design laws.
    }
  }
  cachedSkill = ''
  return cachedSkill
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
    return map[character] ?? character
  })
}

function escapeAttr(value: string): string {
  return escapeHtml(value)
}
