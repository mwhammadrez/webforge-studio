import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { AiService } from '../src/main/services/ai'
import { ProjectService } from '../src/main/services/projects'
import { makeDb, makeLogger, tempDir } from './helpers'
import type { SettingsService } from '../src/main/services/settings'

const plan = {
  brand: { name: 'استودیو نمونه', oneLiner: 'طراحی دقیق و آرام', audience: 'کارفرمای مسکونی', tone: ['آرام', 'دقیق'] },
  design: {
    direction: 'مینیمال تحریریه‌ای با فضای سفید زیاد',
    palette: { bg: '#fbfaf7', fg: '#1c1b19', accent: '#9a5b32', muted: '#6f6a63', surface: '#f0ede7' },
    typography: { display: 'Vazirmatn, system-ui', body: 'Vazirmatn, system-ui', scale: ['clamp(2rem,4vw,3.5rem)', '1.6rem', '1.1rem'] },
    layout: 'ستون‌های نامتقارن',
    motion: 'یک حرکت ملایم در هیرو'
  },
  nav: [{ label: 'خانه', href: '/' }],
  pages: [{ slug: '/', title: 'خانه', goal: 'معرفی استودیو', sections: [{ type: 'hero', intent: 'پیام اصلی' }, { type: 'cta', intent: 'تماس' }] }],
  footer: { columns: ['تماس'], legal: '© ۲۰۲۶' },
  estimatedRequests: 3
}

async function startAiServer(status = 200): Promise<{ url: string; close: () => Promise<void>; calls: number }> {
  let calls = 0
  const server = http.createServer((request, response) => {
    calls += 1
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      if (status !== 200) {
        response.writeHead(status, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: 'unauthorized' }))
        return
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { stream?: boolean }
      if (!body.stream) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }], usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 } }))
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const content = '<section class="hero container"><h1>طراحی که آرام حرف می‌زند</h1><p class="lead">استودیو نمونه</p><a class="btn btn--primary" href="index.html">شروع گفتگو</a></section>'
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } })}\n\n`)
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())), get calls() { return calls } }
}

function service(dir: string, baseUrl: string, key: string | null): AiService {
  const db = makeDb(dir)
  const logger = makeLogger()
  const projects = new ProjectService(db, logger)
  const stub = {
    get: () => ({
      theme: 'dark',
      projectsDir: dir,
      pluginDir: dir,
      portStart: 5173,
      portEnd: 5273,
      aiBaseUrl: baseUrl,
      aiModel: 'deepseek-flash',
      aiKeyConfigured: Boolean(key),
      extraction: { maxFiles: 100, maxBytesMb: 10, maxDepth: 1, timeoutSeconds: 30, concurrency: 2 }
    }),
    getApiKey: () => key
  } as unknown as SettingsService
  return new AiService(stub, projects, logger)
}

describe('AiService', () => {
  it('rejects without an API key before any network call', async () => {
    const dir = tempDir('webforge-ai-')
    const ai = service(dir, 'http://127.0.0.1:1', null)
    await expect(
      ai.plan({ brief: 'یک سایت ساده', businessName: '', audience: '', language: 'fa', pageCount: 1, style: '', colors: '', sections: [] })
    ).rejects.toMatchObject({ code: 'AI_KEY_MISSING' })
  })

  it('parses a plan and generates a complete static site', async () => {
    const dir = tempDir('webforge-ai-')
    const server = await startAiServer()
    const ai = service(dir, server.url, 'test-key')
    const planned = await ai.plan({ brief: 'یک سایت ساده', businessName: 'نمونه', audience: 'مشتری', language: 'fa', pageCount: 1, style: '', colors: '', sections: [] })
    expect(planned.plan.brand.name).toBe('استودیو نمونه')
    expect(planned.estimatedRequests).toBe(3)
    const result = await ai.generate(
      { brief: 'یک سایت ساده', businessName: 'نمونه', audience: 'مشتری', language: 'fa', pageCount: 1, style: '', colors: '', sections: [] },
      planned.plan,
      'job-1',
      () => undefined
    )
    expect(result.projectId).toBeTruthy()
    expect(fs.existsSync(path.join(result.projectPath, 'index.html'))).toBe(true)
    expect(fs.existsSync(path.join(result.projectPath, 'tokens.css'))).toBe(true)
    expect(fs.existsSync(path.join(result.projectPath, 'assets', 'Vazirmatn.woff2'))).toBe(true)
    expect(fs.readFileSync(path.join(result.projectPath, 'tokens.css'), 'utf8')).toContain('@font-face')
    expect(fs.existsSync(path.join(result.projectPath, 'sitemap.xml'))).toBe(true)
    const html = fs.readFileSync(path.join(result.projectPath, 'index.html'), 'utf8')
    expect(html).toContain('طراحی که آرام حرف می‌زند')
    expect(html).toContain('<title>خانه — استودیو نمونه</title>')
    expect(html).not.toContain('<script src="http')
    expect(html).toContain('dir="rtl"')
    expect(result.usage.totalTokens).toBeGreaterThan(0)
    await server.close()
  })

  it('maps unauthorized responses to a Persian error code', async () => {
    const dir = tempDir('webforge-ai-')
    const server = await startAiServer(401)
    const ai = service(dir, server.url, 'bad-key')
    await expect(
      ai.plan({ brief: 'یک سایت ساده', businessName: '', audience: '', language: 'fa', pageCount: 1, style: '', colors: '', sections: [] })
    ).rejects.toMatchObject({ code: 'AI_UNAUTHORIZED' })
    await server.close()
  })
})
