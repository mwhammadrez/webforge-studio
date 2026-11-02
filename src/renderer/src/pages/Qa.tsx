import { useEffect, useMemo, useState } from 'react'
import type { QaFinding, QaReport } from '@shared/types'
import { useApp } from '../store'
import { Button, Empty, Progress, SectionTitle, statusBadge, Tabs } from '../components/ui'
import { Icon } from '../components/Icon'
import { errorMessage, unwrap } from '../lib/api'
import { duration, fa, number } from '../lib/format'

const CHECKS: Array<{ key: string; label: string; desc: string }> = [
  { key: 'html', label: 'ساختار HTML', desc: 'doctype، شناسهٔ تکراری، alt تصاویر، لینک خالی' },
  { key: 'links', label: 'لینک‌ها و درخواست‌ها', desc: 'لینک خراب، ۴۰۴/۵۰۰، منابع ناموفق' },
  { key: 'a11y', label: 'دسترس‌پذیری', desc: 'axe-core / WCAG 2.2 AA' },
  { key: 'seo', label: 'SEO', desc: 'عنوان، description، canonical، h1، lang، viewport' },
  { key: 'performance', label: 'پرفورمنس', desc: 'LCP، زمان بارگذاری، حجم انتقال' },
  { key: 'console', label: 'کنسول', desc: 'خطاهای JavaScript صفحه' },
  { key: 'responsive', label: 'ریسپانسیو', desc: 'سرریز افقی در ۳۷۵/۷۶۸/۱۴۴۰' },
  { key: 'security', label: 'امنیت پایه', desc: 'CSP، X-Content-Type-Options، Referrer-Policy، X-Frame-Options' }
]

const CATEGORY_LABEL: Record<string, string> = {
  html: 'HTML',
  links: 'لینک',
  a11y: 'دسترس‌پذیری',
  seo: 'SEO',
  performance: 'پرفورمنس',
  security: 'امنیت',
  console: 'کنسول',
  responsive: 'ریسپانسیو'
}

export default function Qa(): React.JSX.Element {
  const { projects, activeProjectId } = useApp()
  const setActiveProject = useApp((state) => state.setActiveProject)
  const toast = useApp((state) => state.toast)
  const project = projects.find((item) => item.id === activeProjectId) ?? projects[0] ?? null
  const [checks, setChecks] = useState<string[]>(CHECKS.map((item) => item.key))
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<QaReport | null>(null)
  const [severity, setSeverity] = useState<'all' | 'critical' | 'major' | 'minor' | 'info'>('all')
  const [category, setCategory] = useState<string>('all')
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!project) return
    void (async () => {
      try {
        const file = await unwrap(window.webforge.projects.readFile(project.id, 'reports/qa-report.json'))
        setReport(JSON.parse(file.content) as QaReport)
      } catch {
        setReport(null)
      }
    })()
  }, [project?.id])

  useEffect(() => {
    if (!running) return
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Date.now() - started), 500)
    return () => clearInterval(timer)
  }, [running])

  const run = async (): Promise<void> => {
    if (!project) return
    setRunning(true)
    setElapsed(0)
    setReport(null)
    try {
      const result = await unwrap(window.webforge.qa.run(project.id, [], checks))
      setReport(result)
      toast(result.score >= 85 ? 'success' : 'warn', 'تست کامل شد', `امتیاز ${fa(result.score)} از ۱۰۰ — ${fa(result.findings.length)} یافته`)
    } catch (error) {
      toast('error', 'تست سایت ناموفق بود', errorMessage(error))
    } finally {
      setRunning(false)
    }
  }

  const cancel = async (): Promise<void> => {
    if (!project) return
    try {
      await unwrap(window.webforge.qa.cancel(project.id))
    } catch (error) {
      toast('error', 'لغو تست ناموفق بود', errorMessage(error))
    }
  }

  const counts = useMemo(() => {
    const base: Record<string, number> = { critical: 0, major: 0, minor: 0, info: 0 }
    for (const finding of report?.findings ?? []) base[finding.severity] = (base[finding.severity] ?? 0) + 1
    return base
  }, [report])

  const filtered = useMemo(() => {
    return (report?.findings ?? []).filter(
      (finding) => (severity === 'all' || finding.severity === severity) && (category === 'all' || finding.category === category)
    )
  }, [report, severity, category])

  if (!project) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-header__title">تستر جامع سایت</h1>
            <p className="page-header__sub">یک پروژه انتخاب کن تا تست‌های محلی اجرا شوند.</p>
          </div>
        </div>
        <div className="card">
          <Empty icon="shield" title="پروژه‌ای انتخاب نشده" description="اول یک سایت استخراج کن یا پوشه‌ای باز کن." />
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">تستر جامع سایت</h1>
          <p className="page-header__sub">
            بررسی HTML، لینک‌ها، دسترس‌پذیری (axe-core)، SEO، پرفورمنس، خطاهای کنسول، ریسپانسیو و امنیت پایه — همه محلی و بدون سرویس ابری.
          </p>
        </div>
        <div className="page-header__actions">
          {running ? (
            <Button variant="danger" icon="stop" onClick={() => void cancel()}>لغو تست</Button>
          ) : (
            <Button variant="primary" icon="shield" onClick={() => void run()} loading={running}>
              اجرای تست
            </Button>
          )}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <div className="stack">
          <section className="card card--pad">
            <SectionTitle title="پروژه" hint="پیش‌نمایش به‌صورت خودکار اجرا و بعد از تست متوقف می‌شود." />
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <select className="select" style={{ maxWidth: 360 }} value={project.id} onChange={(event) => setActiveProject(event.target.value)}>
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              {statusBadge(project.status)}
              <span className="path" style={{ flex: 1 }}>{project.path}</span>
            </div>
          </section>

          <section className="card card--pad">
            <SectionTitle title="چه چیزهایی بررسی شود؟" hint="برای شروع همه فعال‌اند." />
            <div className="grid grid--2" style={{ gap: 8 }}>
              {CHECKS.map((check) => (
                <label key={check.key} className="checkbox" style={{ alignItems: 'flex-start', padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--panel-2)' }}>
                  <input
                    type="checkbox"
                    checked={checks.includes(check.key)}
                    onChange={(event) =>
                      setChecks((current) => event.target.checked ? [...current, check.key] : current.filter((item) => item !== check.key))
                    }
                    disabled={running}
                  />
                  <span>
                    <span style={{ fontWeight: 650, display: 'block' }}>{check.label}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{check.desc}</span>
                  </span>
                </label>
              ))}
            </div>
            {running ? (
              <div className="stack" style={{ marginTop: 12, gap: 6 }}>
                <div className="row row--between" style={{ fontSize: 12 }}>
                  <span className="row" style={{ gap: 7 }}><span className="status-dot status-dot--on" /> در حال اجرای تست…</span>
                  <span style={{ color: 'var(--muted)' }}>{duration(elapsed)}</span>
                </div>
                <Progress value={0} total={1} indeterminate />
              </div>
            ) : null}
          </section>

          {report ? (
            <section className="card">
              <div style={{ padding: '14px 16px', display: 'flex', gap: 16, alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                <div className="score-ring" style={{ ['--score' as string]: report.score }}>{fa(report.score)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 750, fontSize: 15 }}>امتیاز کلی کیفیت</div>
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {fa(report.metrics.pages)} صفحه — {duration(report.durationMs)} — {fa(report.findings.length)} یافته
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
                    {(['critical', 'major', 'minor', 'info'] as const).map((key) => (
                      <span key={key} className={`badge ${key === 'critical' ? 'badge--danger' : key === 'major' ? 'badge--warn' : key === 'minor' ? 'badge--info' : ''}`}>
                        {key === 'critical' ? 'بحرانی' : key === 'major' ? 'مهم' : key === 'minor' ? 'جزئی' : 'اطلاع'} {fa(counts[key] ?? 0)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ padding: '10px 16px' }}>
                <Tabs
                  value={severity}
                  onChange={setSeverity}
                  tabs={[
                    { value: 'all', label: 'همه', badge: report.findings.length },
                    { value: 'critical', label: 'بحرانی', badge: counts.critical },
                    { value: 'major', label: 'مهم', badge: counts.major },
                    { value: 'minor', label: 'جزئی', badge: counts.minor },
                    { value: 'info', label: 'اطلاع', badge: counts.info }
                  ]}
                />
                <div className="row" style={{ marginBottom: 8 }}>
                  <select className="select" style={{ maxWidth: 220, minHeight: 32 }} value={category} onChange={(event) => setCategory(event.target.value)}>
                    <option value="all">همهٔ دسته‌ها</option>
                    {Object.entries(CATEGORY_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                  <span className="spacer" />
                  <Button size="sm" variant="ghost" icon="folder" onClick={() => void window.webforge.app.openPath(`${project.path}/reports`)}>پوشهٔ گزارش</Button>
                </div>
                {filtered.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>یافته‌ای در این فیلتر نیست.</div>
                ) : (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                    {filtered.slice(0, 200).map((finding, index) => (
                      <FindingRow key={index} finding={finding} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className="card">
              <Empty
                icon="shield"
                title={running ? 'تست در حال اجراست' : 'هنوز تستی اجرا نشده'}
                description={running ? 'صفحات در Chromium داخلی برنامه باز و بررسی می‌شوند.' : 'دکمهٔ اجرای تست را بزن؛ نتیجه در گزارش JSON ذخیره می‌شود.'}
              />
            </section>
          )}
        </div>

        <div className="stack">
          <section className="card card--pad">
            <SectionTitle title="معیارها" hint="از آخرین اجرا" />
            <div className="grid grid--2" style={{ gap: 8 }}>
              <Metric label="LCP" value={report?.metrics.lcpMs ? `${fa(report.metrics.lcpMs)}ms` : '—'} />
              <Metric label="DOMContentLoaded" value={report?.metrics.domContentLoadedMs ? `${fa(report.metrics.domContentLoadedMs)}ms` : '—'} />
              <Metric label="Load" value={report?.metrics.loadMs ? `${fa(report.metrics.loadMs)}ms` : '—'} />
              <Metric label="حجم انتقال" value={report?.metrics.transferKb ? `${number(report.metrics.transferKb)} KB` : '—'} />
              <Metric label="خطای کنسول" value={fa(report?.metrics.consoleErrors ?? 0)} />
              <Metric label="درخواست ناموفق" value={fa(report?.metrics.failedRequests ?? 0)} />
            </div>
          </section>
          <section className="card card--pad">
            <SectionTitle title="ابزارهای این تست" />
            <div className="stack" style={{ gap: 8, fontSize: 11.5, color: 'var(--muted)' }}>
              <div className="row"><Icon name="check" size={14} /> Chromium داخلی Electron</div>
              <div className="row"><Icon name="check" size={14} /> axe-core — WCAG 2.2 AA</div>
              <div className="row"><Icon name="check" size={14} /> بررسی لینک‌ها و درخواست‌های شبکه</div>
              <div className="row"><Icon name="check" size={14} /> سنجش ریسپانسیو در سه عرض</div>
              <div className="row"><Icon name="check" size={14} /> گزارش JSON قابل آرشیو</div>
            </div>
            <div className="alert alert--info" style={{ marginTop: 10 }}>
              <Icon name="shield" size={15} />
              <span>ابزارهای فعال امنیتی (ZAP/Nuclei) عمداً داخل برنامه نیستند؛ فقط روی محیطی که مالک آن هستی اجرا کن.</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function FindingRow({ finding }: { finding: QaFinding }): React.JSX.Element {
  const cls = finding.severity === 'critical' ? 'critical' : finding.severity === 'major' ? 'major' : finding.severity === 'minor' ? 'minor' : ''
  return (
    <div className="finding">
      <span className={`finding__sev finding__sev--${cls}`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`badge ${finding.severity === 'critical' ? 'badge--danger' : finding.severity === 'major' ? 'badge--warn' : finding.severity === 'minor' ? 'badge--info' : ''}`} style={{ fontSize: 9.5 }}>
            {CATEGORY_LABEL[finding.category] ?? finding.category}
          </span>
          <span style={{ fontSize: 12 }}>{finding.message}</span>
        </div>
        {finding.selector ? <div className="path" style={{ marginTop: 3 }}>{finding.selector}</div> : null}
        {finding.url ? <div className="path" style={{ marginTop: 3, maxWidth: '100%' }}>{finding.url}</div> : null}
        {finding.help ? <a href={finding.help} onClick={(event) => { event.preventDefault(); void window.webforge.app.openExternal(finding.help as string) }} style={{ fontSize: 10.5 }}>راهنما</a> : null}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 10px' }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontWeight: 750, fontSize: 13 }}>{value}</div>
    </div>
  )
}
