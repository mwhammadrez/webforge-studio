import { useState } from 'react'
import type { GithubRepoDetail, GithubRepoSummary, IntegrationReport, Plugin } from '@shared/types'
import { Button, Empty, Modal, SectionTitle } from '../components/ui'
import { useApp } from '../store'
import { Icon } from '../components/Icon'
import { errorMessage, unwrap } from '../lib/api'
import { fa, number, shortDate } from '../lib/format'

const PRESETS = [
  'website builder',
  'landing page generator',
  'html template',
  'design system',
  'css framework',
  'browser automation',
  'static site generator',
  'accessibility testing'
]

export default function Discover(): React.JSX.Element {
  const [query, setQuery] = useState('website builder')
  const [sort, setSort] = useState<'stars' | 'updated' | 'best-match'>('stars')
  const [results, setResults] = useState<GithubRepoSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<GithubRepoDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [report, setReport] = useState<IntegrationReport | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installed, setInstalled] = useState<Plugin | null>(null)
  const [force, setForce] = useState(false)
  const navigate = useApp((state) => state.navigate)
  const toast = useApp((state) => state.toast)

  const search = async (nextPage = 1): Promise<void> => {
    if (!query.trim()) return
    setSearching(true)
    setError(null)
    try {
      const data = await unwrap(window.webforge.discover.search(query.trim(), nextPage, sort))
      setResults(nextPage === 1 ? data.items : [...results, ...data.items])
      setTotal(data.total)
      setPage(nextPage)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSearching(false)
    }
  }

  const inspectRepo = async (): Promise<void> => {
    if (!selected) return
    setInspecting(true)
    setInstalled(null)
    setForce(false)
    try {
      const result = await unwrap(window.webforge.integration.inspect(selected.fullName))
      setReport(result)
      setSelected(null)
    } catch (error) {
      toast('error', 'بازرسی ریپو ناموفق بود', errorMessage(error))
    } finally {
      setInspecting(false)
    }
  }

  const installRepo = async (): Promise<void> => {
    if (!report) return
    setInstalling(true)
    try {
      const result = await unwrap(window.webforge.integration.install(report.fullName, force))
      setInstalled(result.plugin)
      toast('success', 'ابزار به فضای کاری اضافه شد', result.plugin.displayName)
    } catch (error) {
      toast('error', 'افزودن ابزار ناموفق بود', errorMessage(error))
    } finally {
      setInstalling(false)
    }
  }

  const openRepo = async (repo: GithubRepoSummary): Promise<void> => {
    setLoadingDetail(true)
    setSelected(null)
    try {
      const detail = await unwrap(window.webforge.discover.repo(repo.fullName))
      setSelected(detail)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoadingDetail(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">کشف ابزار از GitHub</h1>
          <p className="page-header__sub">
            قبل از استفاده، مجوز، آخرین فعالیت، ریسک و سازگاری بررسی می‌شود. هیچ مخزنی به‌صورت خودکار نصب یا اجرا نمی‌شود.
          </p>
        </div>
      </div>

      <div className="card card--pad stack" style={{ marginBottom: 14 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="row" style={{ flex: 1, minWidth: 260, border: '1px solid var(--border)', borderRadius: 9, paddingInline: 9, background: 'var(--bg-soft)' }}>
            <Icon name="search" size={16} />
            <input
              className="input"
              style={{ border: 0, background: 'transparent', minHeight: 36 }}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void search(1)}
              placeholder="مثلاً static site generator"
            />
          </div>
          <select className="select" style={{ maxWidth: 170 }} value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="stars">بیشترین ستاره</option>
            <option value="updated">آخرین به‌روزرسانی</option>
            <option value="best-match">بهترین تطابق</option>
          </select>
          <Button variant="primary" icon="search" onClick={() => void search(1)} loading={searching}>جستجو</Button>
        </div>
        <div className="row row--wrap" style={{ gap: 5 }}>
          {PRESETS.map((preset) => (
            <button key={preset} className="badge" style={{ cursor: 'pointer' }} onClick={() => { setQuery(preset); }}>
              {preset}
            </button>
          ))}
        </div>
      </div>

      {error ? <div className="alert alert--error" style={{ marginBottom: 12 }}><Icon name="alert" size={16} /><span>{error}</span></div> : null}

      <div className="row row--between" style={{ marginBottom: 8 }}>
        <SectionTitle title={results.length > 0 ? `${number(total)} نتیجه` : 'نتایج'} hint={results.length > 0 ? `${fa(results.length)} مورد نمایش داده شده` : 'عبارت را جستجو کن'} />
      </div>

      {results.length === 0 && !searching ? (
        <div className="card">
          <Empty icon="github" title="جستجو را شروع کن" description="یک عبارت بنویس یا یکی از موضوع‌های آماده را انتخاب کن. نتایج شامل ستاره، مجوز، تاریخ آخرین فعالیت و ریسک هستند." />
        </div>
      ) : (
        <div className="grid grid--2">
          {results.map((repo) => (
            <div key={repo.id} className="card card--hover repo-card" style={{ cursor: 'pointer' }} onClick={() => void openRepo(repo)}>
              <div className="repo-card__head">
                <span className="list__icon"><Icon name="github" size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="repo-card__name">{repo.fullName}</div>
                  <div className="repo-card__desc">{repo.description}</div>
                </div>
                <span className={`badge ${repo.risk.level === 'high' ? 'badge--danger' : repo.risk.level === 'medium' ? 'badge--warn' : 'badge--success'}`}>
                  ریسک {repo.risk.level === 'high' ? 'بالا' : repo.risk.level === 'medium' ? 'متوسط' : 'کم'}
                </span>
              </div>
              <div className="repo-card__meta">
                <span className="badge"><Icon name="sparkles" size={11} /> {number(repo.stars)}</span>
                <span className="badge">{repo.license ?? 'بدون مجوز'}</span>
                {repo.language ? <span className="badge">{repo.language}</span> : null}
                <span className="badge"><Icon name="clock" size={11} /> {shortDate(repo.pushedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {results.length > 0 && results.length < total ? (
        <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
          <Button variant="ghost" icon="plus" onClick={() => void search(page + 1)} loading={searching}>نتایج بیشتر</Button>
        </div>
      ) : null}

      {loadingDetail ? <div className="modal-backdrop"><div className="modal card--pad" style={{ width: 420 }}>در حال خواندن مخزن…</div></div> : null}

      {selected ? (
        <Modal
          title={selected.fullName}
          onClose={() => setSelected(null)}
          width={900}
          footer={
            <>
              <Button variant="ghost" onClick={() => setSelected(null)}>بستن</Button>
              <Button icon="external" onClick={() => void window.webforge.app.openExternal(selected.htmlUrl)}>GitHub</Button>
              <Button variant="primary" icon="layers" onClick={() => void inspectRepo()} loading={inspecting}>بررسی و افزودن</Button>
            </>
          }
        >
          <div className="stack">
            <div className="row row--wrap" style={{ gap: 6 }}>
              <span className={`badge ${selected.risk.level === 'high' ? 'badge--danger' : selected.risk.level === 'medium' ? 'badge--warn' : 'badge--success'}`}>
                ریسک {selected.risk.level === 'high' ? 'بالا' : selected.risk.level === 'medium' ? 'متوسط' : 'کم'}
              </span>
              <span className="badge">{selected.license ?? 'بدون مجوز'}</span>
              <span className="badge"><Icon name="sparkles" size={11} /> {number(selected.stars)}</span>
              <span className="badge">{number(selected.forks)} فورک</span>
              <span className="badge">{selected.language ?? '—'}</span>
              <span className="badge">آخرین فعالیت: {shortDate(selected.pushedAt)}</span>
              <span className="badge">{number(selected.sizeKb)} KB</span>
            </div>
            <div>
              <SectionTitle title="ارزیابی ریسک" />
              {selected.risk.reasons.length === 0 ? (
                <div className="alert alert--success"><Icon name="check" size={15} /><span>نشانهٔ ریسک مهمی دیده نشد؛ با این حال README و وابستگی‌ها را خودت بررسی کن.</span></div>
              ) : (
                <div className="stack" style={{ gap: 5 }}>
                  {selected.risk.reasons.map((reason) => <div key={reason} className="alert alert--warn" style={{ padding: '7px 10px' }}><Icon name="alert" size={14} /><span>{reason}</span></div>)}
                </div>
              )}
            </div>
            <div className="alert alert--info"><Icon name="cpu" size={15} /><span>{selected.compatibility}</span></div>
            <div>
              <SectionTitle title="خلاصهٔ README" hint="متن خام؛ برای جزئیات کامل به GitHub برو." />
              <pre className="log" style={{ maxHeight: 340 }}>{selected.readme.slice(0, 20000) || 'README پیدا نشد.'}</pre>
            </div>
            <div className="alert">
              <Icon name="shield" size={15} />
              <span>ادغام هر مخزن نیازمند بررسی دستی و تأیید است. این صفحه فقط ارزیابی می‌کند و چیزی نصب نمی‌کند.</span>
            </div>
          </div>
        </Modal>
      ) : null}

      {report ? (
        <Modal
          title={`بازرسی ${report.fullName}`}
          onClose={() => { setReport(null); setInstalled(null) }}
          width={860}
          footer={
            installed ? (
              <>
                <Button variant="ghost" onClick={() => { setReport(null); setInstalled(null) }}>بستن</Button>
                <Button variant="primary" icon="layers" onClick={() => navigate('plugins')}>رفتن به ابزارها</Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setReport(null)}>انصراف</Button>
                <Button variant="primary" icon="plus" onClick={() => void installRepo()} loading={installing} disabled={!report.installable || (report.riskLevel === 'high' && !force)}>
                  افزودن به فضای کاری
                </Button>
              </>
            )
          }
        >
          <div className="stack">
            <div className="row row--wrap" style={{ gap: 6 }}>
              <span className={`badge ${report.riskLevel === 'high' ? 'badge--danger' : report.riskLevel === 'medium' ? 'badge--warn' : 'badge--success'}`}>
                ریسک {report.riskLevel === 'high' ? 'بالا' : report.riskLevel === 'medium' ? 'متوسط' : 'کم'}
              </span>
              <span className="badge">{report.runtime}</span>
              <span className="badge">{report.license ?? 'بدون مجوز'}</span>
              <span className="badge">{report.fileCount} فایل</span>
              <span className="badge">{report.ai?.used ? 'بررسی AI انجام شد' : 'بررسی AI خاموش'}</span>
            </div>

            {report.installable ? (
              <div className={`alert ${report.riskLevel === 'high' ? 'alert--warn' : 'alert--success'}`}>
                <Icon name={report.riskLevel === 'high' ? 'alert' : 'check'} size={16} />
                <span>{report.reason}</span>
              </div>
            ) : (
              <div className="alert alert--warn"><Icon name="alert" size={16} /><span>{report.reason}</span></div>
            )}

            {report.ai?.summary ? (
              <div className="alert alert--info"><Icon name="cpu" size={16} /><span>{report.ai.summary}</span></div>
            ) : null}

            {report.ai?.capabilities?.length ? (
              <div className="row row--wrap" style={{ gap: 5 }}>
                {report.ai.capabilities.map((capability) => <span key={capability} className="badge">{capability}</span>)}
              </div>
            ) : null}

            <div>
              <SectionTitle title="یافته‌های بازرسی" hint={`${report.findings.length} مورد`} />
              {report.findings.length === 0 ? (
                <div className="alert alert--success"><Icon name="check" size={15} /><span>یافتهٔ مهمی دیده نشد.</span></div>
              ) : (
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', maxHeight: 260, overflowY: 'auto' }}>
                  {report.findings.map((finding, index) => (
                    <div key={index} className="finding">
                      <span className={`finding__sev ${finding.severity === 'critical' ? 'finding__sev--critical' : finding.severity === 'warning' ? 'finding__sev--major' : ''}`} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12 }}>{finding.message}</div>
                        {finding.file ? <div className="path" style={{ marginTop: 2 }}>{finding.file}</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {report.proposedManifest ? (
              <div>
                <SectionTitle title="مانیفست پیشنهادی" hint="قبل از افزودن بررسی کن" />
                <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 11.5 }}>
                  <div className="row row--between"><span className="muted">نام</span><span className="code">{report.proposedManifest.name}</span></div>
                  <div className="row row--between"><span className="muted">Runtime</span><span className="code">{report.proposedManifest.runtime}</span></div>
                  <div className="row row--between"><span className="muted">دسترسی شبکه</span><span>{report.proposedManifest.permissions.network ? 'بله' : 'خیر'}</span></div>
                  <div className="row row--between"><span className="muted">نوشتن در پروژه</span><span>{report.proposedManifest.permissions.projectWrite ? 'بله' : 'خیر'}</span></div>
                  {report.usage ? <div style={{ marginTop: 8 }}><span className="muted">نحوهٔ استفاده: </span><span>{report.usage}</span></div> : null}
                </div>
              </div>
            ) : null}

            {report.riskLevel === 'high' && report.installable && !installed ? (
              <label className="checkbox" style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 9, background: 'var(--danger-soft)' }}>
                <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
                <span>ریسک این ابزار بالاست و مسئولیت اجرای آن را می‌پذیرم.</span>
              </label>
            ) : null}

            {installed ? (
              <div className="alert alert--success">
                <Icon name="check" size={16} />
                <span>
                  «{installed.displayName}» با شناسهٔ <span className="code">{installed.name}</span> ثبت شد. اگر ابزار Node است، در صفحهٔ ابزارها «نصب وابستگی‌ها» را بزن.
                </span>
              </div>
            ) : null}

            <div className="alert">
              <Icon name="shield" size={15} />
              <span>هیچ اسکریپت نصب یا کدی هنگام بازرسی اجرا نمی‌شود. نصب وابستگی‌ها با <span className="code">--ignore-scripts</span> انجام می‌شود؛ اجرای ابزار همچنان ریسک خودش را دارد.</span>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
