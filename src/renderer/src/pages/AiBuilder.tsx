import { useEffect, useRef, useState } from 'react'
import type { AiBrief, AiGenerateResult, AiPlanResult, AiProgress, AiSitePlan } from '@shared/types'
import { useApp } from '../store'
import { Button, Empty, Field, Progress, SectionTitle } from '../components/ui'
import { Icon } from '../components/Icon'
import { errorMessage, unwrap } from '../lib/api'
import { fa } from '../lib/format'

const STAGES = [
  { key: 'tokens', label: 'توکن‌های طراحی' },
  { key: 'shell', label: 'پوسته و منو' },
  { key: 'page', label: 'صفحات' },
  { key: 'writing', label: 'ذخیره' },
  { key: 'done', label: 'پایان' }
]

export default function AiBuilder(): React.JSX.Element {
  const { settings } = useApp()
  const navigate = useApp((state) => state.navigate)
  const toast = useApp((state) => state.toast)
  const refreshProjects = useApp((state) => state.refreshProjects)
  const refreshSettings = useApp((state) => state.refreshSettings)
  const [brief, setBrief] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [audience, setAudience] = useState('')
  const [language, setLanguage] = useState<'fa' | 'en'>('fa')
  const [pageCount, setPageCount] = useState(4)
  const [style, setStyle] = useState('')
  const [colors, setColors] = useState('')
  const [sections, setSections] = useState('')
  const [outputRoot, setOutputRoot] = useState('')
  const [planning, setPlanning] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [plan, setPlan] = useState<AiPlanResult | null>(null)
  const [result, setResult] = useState<AiGenerateResult | null>(null)
  const [progress, setProgress] = useState<AiProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const jobRef = useRef<string | null>(null)

  useEffect(() => {
    const unsubscribe = window.webforge.ai.onProgress((next) => setProgress(next))
    return unsubscribe
  }, [])

  const makeBrief = (): AiBrief => ({
    brief,
    businessName,
    audience,
    language,
    pageCount,
    style,
    colors,
    sections: sections.split(',').map((item) => item.trim()).filter(Boolean),
    outputRoot: outputRoot || undefined
  })

  const validate = (): boolean => {
    if (!settings?.aiKeyConfigured) {
      setError('برای استفاده از هوش مصنوعی، کلید API را در تنظیمات وارد کن.')
      return false
    }
    if (brief.trim().length < 10) {
      setError('توضیح سایت حداقل ۱۰ کاراکتر باشد.')
      return false
    }
    return true
  }

  const createPlan = async (): Promise<void> => {
    setError(null)
    setResult(null)
    if (!validate()) return
    setPlanning(true)
    try {
      const next = await unwrap(window.webforge.ai.plan(makeBrief()))
      setPlan(next)
      toast('success', 'پلن سایت آماده است', 'قبل از ساخت، پلن را بررسی و تأیید کن.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPlanning(false)
    }
  }

  const generate = async (): Promise<void> => {
    if (!plan) return
    setError(null)
    setGenerating(true)
    setProgress({ stage: 'tokens', current: 0, total: plan.plan.pages.length + 2, message: 'شروع ساخت…', file: null })
    const jobId = crypto.randomUUID()
    jobRef.current = jobId
    try {
      const data = await unwrap(window.webforge.ai.generate(makeBrief(), plan.plan as AiSitePlan, jobId))
      setResult(data)
      await refreshProjects()
      await refreshSettings()
      toast('success', 'سایت ساخته شد', `${fa(data.files.length)} فایل`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setGenerating(false)
      jobRef.current = null
    }
  }

  const cancel = async (): Promise<void> => {
    if (!jobRef.current) return
    try {
      await unwrap(window.webforge.ai.cancel(jobRef.current))
    } catch (err) {
      toast('error', 'لغو ساخت ناموفق بود', errorMessage(err))
    }
  }

  const chooseFolder = async (): Promise<void> => {
    const folder = await unwrap(window.webforge.app.pickFolder('پوشهٔ خروجی سایت'))
    if (folder) setOutputRoot(folder)
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">ساخت سایت با هوش مصنوعی</h1>
          <p className="page-header__sub">
            اول یک پلن دقیق (برند، پالت، تایپوگرافی و صفحات) ساخته می‌شود؛ بعد از تأیید تو، پوسته و توکن‌ها قطعی ساخته و صفحات یکی‌یکی تولید می‌شوند.
          </p>
        </div>
        <div className="page-header__actions">
          {generating ? <Button variant="danger" icon="stop" onClick={() => void cancel()}>لغو ساخت</Button> : null}
          {!settings?.aiKeyConfigured ? (
            <Button icon="settings" onClick={() => navigate('settings')}>تنظیم کلید API</Button>
          ) : null}
        </div>
      </div>

      {!settings?.aiKeyConfigured ? (
        <div className="alert alert--warn" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={17} />
          <span>کلید API هوش مصنوعی تنظیم نشده است. بدون کلید، هیچ درخواست پولی ارسال نمی‌شود.</span>
        </div>
      ) : null}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.2fr) minmax(320px, 1fr)', alignItems: 'start' }}>
        <section className="card card--pad stack">
          <SectionTitle title="توضیح سایت" hint="هرچه دقیق‌تر، نتیجه بهتر. زبان و مخاطب را مشخص کن." />
          <Field label="چه سایتی می‌خواهی؟" required>
            <textarea
              className="textarea"
              style={{ minHeight: 150 }}
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="مثلاً: سایت یک استودیوی معماری در تهران که پروژه‌های مسکونی مینیمال انجام می‌دهد. می‌خواهم حس آرام، دقیق و گران‌قیمت داشته باشد، با تمرکز روی عکس پروژه‌ها و متن‌های کوتاه."
              disabled={generating}
            />
          </Field>
          <div className="grid grid--2">
            <Field label="نام کسب‌وکار"><input className="input" value={businessName} onChange={(event) => setBusinessName(event.target.value)} disabled={generating} /></Field>
            <Field label="مخاطب هدف"><input className="input" value={audience} onChange={(event) => setAudience(event.target.value)} disabled={generating} /></Field>
            <Field label="زبان">
              <select className="select" value={language} onChange={(event) => setLanguage(event.target.value as 'fa' | 'en')} disabled={generating}>
                <option value="fa">فارسی (RTL)</option>
                <option value="en">English (LTR)</option>
              </select>
            </Field>
            <Field label="تعداد صفحات">
              <input className="input" type="number" min={1} max={12} value={pageCount} onChange={(event) => setPageCount(Number(event.target.value))} disabled={generating} />
            </Field>
            <Field label="سبک بصری"><input className="input" value={style} onChange={(event) => setStyle(event.target.value)} placeholder="مینیمال، گرم، تحریریه…" disabled={generating} /></Field>
            <Field label="رنگ‌ها"><input className="input" value={colors} onChange={(event) => setColors(event.target.value)} placeholder="مثلاً خاکی و سبز زیتونی" disabled={generating} /></Field>
          </div>
          <Field label="بخش‌های لازم" hint="با ویرگول جدا کن؛ خالی بگذار تا AI تصمیم بگیرد.">
            <input className="input" value={sections} onChange={(event) => setSections(event.target.value)} placeholder="هیرو، خدمات، نمونه‌کار، نظرات، تماس" disabled={generating} />
          </Field>
          <Field label="پوشهٔ خروجی" hint={outputRoot || settings?.projectsDir}>
            <div className="row">
              <input className="input path" value={outputRoot || settings?.projectsDir || ''} readOnly dir="ltr" />
              <Button variant="ghost" icon="folder" onClick={() => void chooseFolder()} disabled={generating} aria-label="انتخاب پوشه" />
            </div>
          </Field>

          {error ? <div className="alert alert--error"><Icon name="alert" size={16} /><span>{error}</span></div> : null}

          <div className="row">
            <Button variant="primary" icon="sparkles" onClick={() => void createPlan()} loading={planning} disabled={generating}>
              {plan ? 'ساخت پلن جدید' : 'ساخت پلن سایت'}
            </Button>
            {plan ? (
              <Button icon="rocket" onClick={() => void generate()} loading={generating} disabled={generating}>
                تأیید پلن و ساخت سایت
              </Button>
            ) : null}
          </div>
          <div className="alert alert--info">
            <Icon name="shield" size={16} />
            <span>فقط پس از تأیید تو درخواست به DeepSeek ارسال می‌شود. مدل پیش‌فرض <span className="code">{settings?.aiModel}</span> است و هزینهٔ تقریبی قبل از ساخت نمایش داده می‌شود.</span>
          </div>
        </section>

        <div className="stack">
          {plan ? (
            <section className="card card--pad stack">
              <SectionTitle
                title="پلن پیشنهادی"
                hint={`${fa(plan.estimatedRequests)} درخواست تقریبی — حدود ${fa(plan.estimatedCostUsd)} دلار`}
                action={<span className="badge badge--accent">{plan.model}</span>}
              />
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{plan.plan.brand.name}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>{plan.plan.brand.oneLiner}</div>
                <div className="row" style={{ gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
                  {plan.plan.brand.tone.map((tone) => <span key={tone} className="badge">{tone}</span>)}
                </div>
              </div>
              <div>
                <div className="field__label" style={{ marginBottom: 6 }}>پالت</div>
                <div className="grid grid--4" style={{ gap: 6 }}>
                  {Object.entries(plan.plan.design.palette).map(([key, value]) => (
                    <div key={key}>
                      <div className="swatch" style={{ background: value, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,.6)' }}>{value}</div>
                      <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 2 }}>{key}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="stack" style={{ gap: 4 }}>
                <div className="field__label">جهت طراحی</div>
                <div style={{ fontSize: 12, color: 'var(--text-soft)' }}>{plan.plan.design.direction}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{plan.plan.design.layout}</div>
              </div>
              <div>
                <div className="field__label" style={{ marginBottom: 6 }}>صفحات</div>
                <div className="stack" style={{ gap: 6 }}>
                  {plan.plan.pages.map((page) => (
                    <div key={page.slug} style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 10px' }}>
                      <div className="row row--between">
                        <span style={{ fontWeight: 700, fontSize: 12 }}>{page.title}</span>
                        <span className="code">{page.slug}</span>
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{page.goal}</div>
                      <div className="row" style={{ gap: 3, marginTop: 5, flexWrap: 'wrap' }}>
                        {page.sections.map((section, index) => <span key={index} className="badge" style={{ fontSize: 9.5 }}>{section.type}</span>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : (
            <section className="card">
              <Empty icon="sparkles" title="پلن هنوز ساخته نشده" description="توضیح سایت را بنویس و «ساخت پلن سایت» را بزن. پلن قبل از هر هزینه‌ای نمایش داده می‌شود." />
            </section>
          )}

          {progress ? (
            <section className="card card--pad stack">
              <SectionTitle title="پیشرفت ساخت" hint={progress.message} />
              <div className="steps">
                {STAGES.map((stage) => {
                  const index = STAGES.findIndex((item) => item.key === progress.stage)
                  const currentIndex = STAGES.findIndex((item) => item.key === stage.key)
                  const state = currentIndex < index ? 'done' : currentIndex === index ? 'active' : 'idle'
                  return <span key={stage.key} className="step" data-state={state}>{stage.label}</span>
                })}
              </div>
              <Progress value={progress.current} total={progress.total} indeterminate={generating && progress.stage === 'tokens'} />
              <div className="path">{progress.file ?? ''}</div>
            </section>
          ) : null}

          {result ? (
            <section className="card card--pad stack">
              <div className="alert alert--success"><Icon name="check" size={16} /><span>سایت ساخته شد و در پروژه ذخیره شد.</span></div>
              <div className="grid grid--2" style={{ gap: 8 }}>
                <MiniStat label="فایل‌ها" value={fa(result.files.length)} />
                <MiniStat label="توکن مصرفی" value={fa(result.usage.totalTokens)} />
              </div>
              <div className="stack" style={{ gap: 3, maxHeight: 180, overflow: 'auto' }}>
                {result.files.map((file) => <div key={file} className="path">{file}</div>)}
              </div>
              <div className="row">
                <Button variant="primary" icon="edit" onClick={() => navigate('workspace', result.projectId)}>باز کردن در ویرایشگر</Button>
                <Button icon="shield" onClick={() => navigate('qa', result.projectId)}>تست سایت</Button>
                <Button variant="ghost" icon="folder" onClick={() => void window.webforge.app.openPath(result.projectPath)} aria-label="پوشه" />
              </div>
            </section>
          ) : null}

          <section className="card card--pad">
            <SectionTitle title="چطور کیفیت حفظ می‌شود؟" />
            <div className="stack" style={{ gap: 7, fontSize: 11.5, color: 'var(--muted)' }}>
              <div className="row"><Icon name="check" size={13} /> پلن و تصمیم طراحی قبل از تولید کد</div>
              <div className="row"><Icon name="check" size={13} /> پوسته و توکن‌ها قطعی، بدون تکرار هزینه برای هر صفحه</div>
              <div className="row"><Icon name="check" size={13} /> قواعد ضد «سایت AI عمومی» و کنتراست ۴.۵:۱</div>
              <div className="row"><Icon name="check" size={13} /> بدون اسکریپت یا CDN خارجی در خروجی</div>
              <div className="row"><Icon name="check" size={13} /> فایل‌های ناقص حفظ می‌شوند و قابل ادامه‌اند</div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 10px' }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontWeight: 750 }}>{value}</div>
    </div>
  )
}
