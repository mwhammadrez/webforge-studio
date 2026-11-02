import { useEffect, useState } from 'react'
import type { Project } from '@shared/types'
import { useApp } from '../store'
import { Icon, type IconName } from '../components/Icon'
import { Button, Empty, SectionTitle, statusBadge } from '../components/ui'
import { unwrap } from '../lib/api'
import { fa, timeAgo } from '../lib/format'

const ACTIONS: Array<{ route: Parameters<ReturnType<typeof useApp.getState>['navigate']>[0]; title: string; desc: string; icon: IconName }> = [
  {
    route: 'extract',
    title: 'استخراج سایت',
    desc: 'آدرس یک سایت عمومی را بده و کل HTML، CSS، JS، تصاویر و فونت‌ها را محلی کن.',
    icon: 'download'
  },
  {
    route: 'workspace',
    title: 'ویرایشگر بصری',
    desc: 'روی هر متن، عکس یا استایل کلیک کن و همان‌جا تغییرش بده؛ با پشتیبان و Undo.',
    icon: 'edit'
  },
  {
    route: 'ai',
    title: 'ساخت سایت با AI',
    desc: 'توضیح بده چه سایتی می‌خواهی؛ پلن و طراحی حرفه‌ای، صفحه‌به‌صفحه ساخته می‌شود.',
    icon: 'sparkles'
  },
  {
    route: 'qa',
    title: 'تستر جامع',
    desc: 'HTML، لینک‌ها، دسترس‌پذیری، SEO، پرفورمنس، موبایل و امنیت را یک‌جا بسنج.',
    icon: 'shield'
  },
  {
    route: 'plugins',
    title: 'ابزارها و پنل ادمین',
    desc: 'پنل مدیریت روی سایت نصب کن یا ابزارهای Node/Python خودت را به‌عنوان پلاگین اجرا کن.',
    icon: 'layers'
  },
  {
    route: 'discover',
    title: 'کشف ابزار',
    desc: 'در GitHub ابزارهای کاربردی طراحی سایت را پیدا و قبل از استفاده ارزیابی کن.',
    icon: 'github'
  }
]

export default function Dashboard(): React.JSX.Element {
  const { projects, settings, preview } = useApp()
  const navigate = useApp((state) => state.navigate)
  const refreshProjects = useApp((state) => state.refreshProjects)
  const [recent, setRecent] = useState<Project[]>([])
  const [diagnostics, setDiagnostics] = useState<{ counts: { edits: number; runs: number; plugins: number } } | null>(null)

  useEffect(() => {
    setRecent(projects.slice(0, 5))
  }, [projects])

  useEffect(() => {
    void (async () => {
      try {
        const data = await unwrap(window.webforge.diagnostics.get())
        setDiagnostics(data)
      } catch {
        setDiagnostics(null)
      }
    })()
    void refreshProjects()
  }, [refreshProjects])

  const openProject = (project: Project): void => {
    navigate('workspace', project.id)
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">فضای کاری تو</h1>
          <p className="page-header__sub">
            استخراج، ویرایش، ساخت و تست سایت — همه در یک برنامهٔ محلی. پروژه‌ها روی همین سیستم می‌مانند.
          </p>
        </div>
        <div className="page-header__actions">
          <Button icon="plus" onClick={() => navigate('extract')}>
            پروژهٔ جدید
          </Button>
          <Button variant="primary" icon="sparkles" onClick={() => navigate('ai')}>
            ساخت با AI
          </Button>
        </div>
      </div>

      <div className="grid grid--4" style={{ marginBottom: 18 }}>
        <div className="card stat-card">
          <span className="stat-card__label">پروژه‌ها</span>
          <span className="stat-card__value">{fa(projects.length)}</span>
          <span className="stat-card__meta">{fa(projects.filter((project) => project.status === 'partial').length)} مورد با هشدار</span>
        </div>
        <div className="card stat-card">
          <span className="stat-card__label">پیش‌نمایش فعال</span>
          <span className="stat-card__value">{preview?.running ? 'بله' : 'خیر'}</span>
          <span className="stat-card__meta mono">{preview?.url ?? '—'}</span>
        </div>
        <div className="card stat-card">
          <span className="stat-card__label">ویرایش‌های ثبت‌شده</span>
          <span className="stat-card__value">{fa(diagnostics?.counts.edits ?? 0)}</span>
          <span className="stat-card__meta">با پشتیبان و امکان بازگردانی</span>
        </div>
        <div className="card stat-card">
          <span className="stat-card__label">هوش مصنوعی</span>
          <span className="stat-card__value" style={{ fontSize: 17 }}>
            {settings?.aiKeyConfigured ? 'آماده' : 'تنظیم نشده'}
          </span>
          <span className="stat-card__meta">{settings?.aiKeyConfigured ? settings.aiModel : 'کلید DeepSeek را در تنظیمات وارد کن'}</span>
        </div>
      </div>

      <div className="grid grid--3">
        {ACTIONS.map((action) => (
          <button key={action.route} className="card card--hover action-card" onClick={() => navigate(action.route)}>
            <span className="action-card__icon">
              <Icon name={action.icon} size={19} />
            </span>
            <span className="action-card__title">{action.title}</span>
            <span className="action-card__desc">{action.desc}</span>
            <span className="action-card__arrow">
              <Icon name="arrow-right" size={16} />
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid--2" style={{ marginTop: 18, alignItems: 'start' }}>
        <section className="card">
          <div style={{ padding: '14px 16px 8px' }}>
            <SectionTitle
              title="پروژه‌های اخیر"
              hint="آخرین سایت‌هایی که باز کردی"
              action={
                <Button size="sm" variant="ghost" onClick={() => navigate('projects')}>
                  همه
                </Button>
              }
            />
          </div>
          {recent.length === 0 ? (
            <Empty
              icon="folder"
              title="هنوز پروژه‌ای نداری"
              description="برای شروع، یک سایت را استخراج کن یا یک پوشه را باز کن."
              action={
                <Button variant="primary" icon="download" onClick={() => navigate('extract')}>
                  استخراج سایت
                </Button>
              }
            />
          ) : (
            <div className="list">
              {recent.map((project) => (
                <button key={project.id} className="list__item" onClick={() => openProject(project)}>
                  <span className="list__icon">
                    <Icon name="globe" size={16} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="list__title">{project.name}</span>
                    <span className="list__meta">{project.path}</span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    {statusBadge(project.status)}
                    <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{timeAgo(project.lastOpenedAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="card card--pad">
          <SectionTitle title="وضعیت سیستم" hint="پروسه‌ها و سرویس‌های محلی" />
          <div className="stack" style={{ gap: 10 }}>
            <div className="row row--between" style={{ fontSize: 12.5 }}>
              <span className="row" style={{ gap: 8 }}>
                <span className={`status-dot ${preview?.running ? 'status-dot--on' : ''}`} />
                سرور پیش‌نمایش
              </span>
              <span className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>
                {preview?.url ?? 'خاموش'}
              </span>
            </div>
            <div className="row row--between" style={{ fontSize: 12.5 }}>
              <span className="row" style={{ gap: 8 }}>
                <span className={`status-dot ${diagnostics && diagnostics.counts.plugins > 0 ? 'status-dot--on' : ''}`} />
                ابزارهای ثبت‌شده
              </span>
              <span style={{ color: 'var(--muted)' }}>{fa(diagnostics?.counts.plugins ?? 0)}</span>
            </div>
            <div className="row row--between" style={{ fontSize: 12.5 }}>
              <span className="row" style={{ gap: 8 }}>
                <span className={`status-dot ${settings?.aiKeyConfigured ? 'status-dot--on' : ''}`} />
                سرویس هوش مصنوعی
              </span>
              <span style={{ color: 'var(--muted)' }}>{settings?.aiKeyConfigured ? settings.aiModel : 'بدون کلید'}</span>
            </div>
            <div className="alert alert--info" style={{ marginTop: 4 }}>
              <Icon name="shield" size={17} />
              <span>
                همهٔ داده‌ها محلی است. کلید API رمزنگاری‌شده ذخیره می‌شود و در خروجی‌ها قرار نمی‌گیرد.
              </span>
            </div>
            <Button variant="ghost" icon="settings" onClick={() => navigate('settings')}>
              تنظیمات برنامه
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}
