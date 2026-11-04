import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GithubRepoDetail, GithubRepoSummary, PluginInput, PluginRunResult, ToolConnectPlan, ToolConnectResult } from '@shared/types'
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

const STRATEGY_HINT: Record<ToolConnectPlan['strategy'], string> = {
  'local-node': 'فایل‌های ابزار کپی و با Node داخلیٔ برنامه اجرا می‌شوند.',
  'npm-package': 'ابزار با npx از registry در اولین اجرا دریافت می‌شود.',
  'local-python': 'اسکریپت پایتون با مفسر سیستم اجرا می‌شود.',
  'static-project': 'مخزن به‌عنوان یک پروژهٔ قابل ویرایش به فضای کاری اضافه می‌شود.',
  manual: 'اتصال خودکاری ممکن نیست؛ مراحل دستی را ببین.'
}

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
  const [report, setReport] = useState<(ToolConnectResult['report'] & { connect: ToolConnectPlan }) | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [force, setForce] = useState(false)
  const [withDependencies, setWithDependencies] = useState(true)
  const [outcome, setOutcome] = useState<ToolConnectResult | null>(null)
  const [hasAiKey, setHasAiKey] = useState(false)
  const navigate = useApp((state) => state.navigate)
  const toast = useApp((state) => state.toast)
  const activeProjectId = useApp((state) => state.activeProjectId)

  useEffect(() => {
    void unwrap(window.webforge.app.info())
      .then((info) => setHasAiKey(info.hasAiKey))
      .catch(() => setHasAiKey(false))
  }, [])

  const search = async (nextPage = 1, text = query): Promise<void> => {
    if (!text.trim()) return
    setSearching(true)
    setError(null)
    try {
      const data = await unwrap(window.webforge.discover.search(text.trim(), nextPage, sort))
      setResults(nextPage === 1 ? data.items : [...results, ...data.items])
      setTotal(data.total)
      setPage(nextPage)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSearching(false)
    }
  }

  const openRepo = async (repo: GithubRepoSummary): Promise<void> => {
    setLoadingDetail(true)
    setError(null)
    try {
      setSelected(await unwrap(window.webforge.discover.repo(repo.fullName)))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoadingDetail(false)
    }
  }

  const inspectRepo = async (): Promise<void> => {
    if (!selected) return
    setInspecting(true)
    setReport(null)
    setOutcome(null)
    setForce(false)
    try {
      setReport(await unwrap(window.webforge.integration.inspect(selected.fullName)))
    } catch (err) {
      toast('error', 'بازرسی ریپو ناموفق بود', errorMessage(err))
    } finally {
      setInspecting(false)
    }
  }

  const connectRepo = async (): Promise<void> => {
    if (!report) return
    setConnecting(true)
    try {
      const result = await unwrap(window.webforge.integration.connect(report.fullName, { force, installDependencies: withDependencies }))
      setOutcome(result)
      const name = result.plugin?.displayName ?? result.project?.name ?? ''
      toast('success', result.project ? 'به پروژه‌ها اضافه شد' : 'ابزار متصل شد', name)
    } catch (err) {
      toast('error', 'اتصال ابزار ناموفق بود', errorMessage(err))
    } finally {
      setConnecting(false)
    }
  }

  const closeAll = useCallback((): void => {
    setReport(null)
    setOutcome(null)
    setSelected(null)
  }, [])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">کشف و اتصال ابزار</h1>
          <p className="page-header__sub">
            مخزن را جستجو کن؛ WebForge آن را بازرسی می‌کند، راه اتصال را تصمیم می‌گیرد و خودش وصلش می‌کند.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className={`badge ${hasAiKey ? 'badge--success' : 'badge--warn'}`}>
            <Icon name="cpu" size={12} /> {hasAiKey ? 'هوش مصنوعی آمادهٔ تصمیم‌گیری است' : 'کلید API ندارد؛ تشخیص خودکار'}
          </span>
          {!hasAiKey ? <Button size="sm" variant="ghost" icon="settings" onClick={() => navigate('settings')}>تنظیمات</Button> : null}
        </div>
      </div>

      <Stepper step={outcome ? 4 : report ? 3 : selected ? 2 : 1} />

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
            <button key={preset} className="badge" style={{ cursor: 'pointer' }} onClick={() => { setQuery(preset); void search(1, preset); }}>
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
          <Empty icon="github" title="جستجو را شروع کن" description="یک عبارت بنویس یا یکی از موضوع‌های آماده را انتخاب کن. روی یک نتیجه کلیک کن تا بازرسی و اتصال انجام شود." />
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
                <RiskBadge level={repo.risk.level} />
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

      {selected && !report ? (
        <Modal
          title={selected.fullName}
          onClose={() => setSelected(null)}
          width={900}
          footer={
            <>
              <Button variant="ghost" onClick={() => setSelected(null)}>بستن</Button>
              <Button icon="external" onClick={() => void window.webforge.app.openExternal(selected.htmlUrl)}>GitHub</Button>
              <Button variant="primary" icon="cpu" onClick={() => void inspectRepo()} loading={inspecting}>
                بازرسی و تصمیم برای اتصال
              </Button>
            </>
          }
        >
          <div className="stack">
            <div className="row row--wrap" style={{ gap: 6 }}>
              <RiskBadge level={selected.risk.level} />
              <span className="badge">{selected.license ?? 'بدون مجوز'}</span>
              <span className="badge"><Icon name="sparkles" size={11} /> {number(selected.stars)}</span>
              <span className="badge">{number(selected.forks)} فورک</span>
              <span className="badge">{selected.language ?? '—'}</span>
              <span className="badge">آخرین فعالیت: {shortDate(selected.pushedAt)}</span>
            </div>
            <div className="alert alert--info"><Icon name="cpu" size={15} /><span>{selected.compatibility}</span></div>
            {selected.risk.reasons.length > 0 ? (
              <div className="stack" style={{ gap: 5 }}>
                {selected.risk.reasons.map((reason) => (
                  <div key={reason} className="alert alert--warn" style={{ padding: '7px 10px' }}><Icon name="alert" size={14} /><span>{reason}</span></div>
                ))}
              </div>
            ) : null}
            <div>
              <SectionTitle title="README" hint="متن خام؛ برای جزئیات کامل به GitHub برو." />
              <pre className="log" style={{ maxHeight: 300 }}>{selected.readme.slice(0, 20000) || 'README پیدا نشد.'}</pre>
            </div>
            <div className="alert"><Icon name="shield" size={15} /><span>هنگام بازرسی هیچ کدی اجرا نمی‌شود؛ فقط فایل‌ها خوانده و بررسی می‌شوند.</span></div>
          </div>
        </Modal>
      ) : null}

      {report ? (
        <ConnectModal
          report={report}
          connecting={connecting}
          force={force}
          setForce={setForce}
          withDependencies={withDependencies}
          setWithDependencies={setWithDependencies}
          outcome={outcome}
          activeProjectId={activeProjectId}
          onConnect={() => void connectRepo()}
          onClose={closeAll}
          onReinspect={() => void inspectRepo()}
          navigate={navigate}
          toast={toast}
        />
      ) : null}

      {inspecting ? (
        <div className="modal-backdrop">
          <div className="modal card--pad" style={{ width: 460 }}>
            <div className="stack" style={{ gap: 10 }}>
              <h3 style={{ margin: 0 }}>در حال بازرسی و طراحی اتصال…</h3>
              <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
                فایل‌ها دانلود و اسکن می‌شوند{hasAiKey ? '، بعد هوش مصنوعی نحوهٔ اتصال را تصمیم می‌گیرد' : ''}. ممکن است چند دقیقه طول بکشد.
              </p>
              <div className="muted" style={{ fontSize: 11.5 }}>دانلود مخزن ← اسکن امنیتی ← تحلیل README ← ساخت طرح اتصال</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ConnectModal({
  report,
  connecting,
  force,
  setForce,
  withDependencies,
  setWithDependencies,
  outcome,
  activeProjectId,
  onConnect,
  onClose,
  onReinspect,
  navigate,
  toast
}: {
  report: NonNullable<ToolConnectResult['report']>
  connecting: boolean
  force: boolean
  setForce: (value: boolean) => void
  withDependencies: boolean
  setWithDependencies: (value: boolean) => void
  outcome: ToolConnectResult | null
  activeProjectId: string | null
  onConnect: () => void
  onClose: () => void
  onReinspect: () => void
  navigate: ReturnType<typeof useApp.getState>['navigate']
  toast: ReturnType<typeof useApp.getState>['toast']
}): React.JSX.Element {
  const plan = report.connect
  // Importing a site as a project runs nothing; only strategies that execute code need the
  // explicit risk acceptance, otherwise every site without a LICENSE file looks dangerous.
  const needsForce = report.riskLevel === 'high' && plan.strategy !== 'static-project'
  const canConnect = plan.actionable && (!needsForce || force)

  return (
    <Modal
      title={`${report.fullName} — طرح اتصال`}
      onClose={onClose}
      width={940}
      footer={
        outcome ? (
          <>
            <Button variant="ghost" onClick={onClose}>بستن</Button>
            {outcome.project ? (
              <Button variant="primary" icon="edit" onClick={() => { navigate('workspace', outcome.project?.id); onClose() }}>
                باز کردن در ویرایشگر بصری
              </Button>
            ) : (
              <Button variant="primary" icon="layers" onClick={() => { navigate('plugins'); onClose() }}>رفتن به ابزارها</Button>
            )}
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>انصراف</Button>
            <Button icon="refresh" onClick={onReinspect}>بازرسی دوباره</Button>
            <Button variant="primary" icon="layers" onClick={onConnect} loading={connecting} disabled={!canConnect}>
              {plan.strategy === 'static-project' ? 'افزودن به پروژه‌ها' : 'اتصال به برنامه'}
            </Button>
          </>
        )
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <div className="row row--wrap" style={{ gap: 6 }}>
          <RiskBadge level={report.riskLevel} />
          <span className="badge badge--accent">{plan.title}</span>
          <span className="badge">{report.runtime}</span>
          <span className="badge">{report.license ?? 'بدون مجوز'}</span>
          <span className="badge">{fa(report.fileCount)} فایل</span>
          <span className="badge">{plan.usedAi ? `تصمیم هوش مصنوعی (${fa(Math.round(plan.confidence * 100))}٪)` : 'تشخیص خودکار'}</span>
        </div>

        <div className={`alert ${plan.actionable ? 'alert--success' : 'alert--warn'}`}>
          <Icon name={plan.actionable ? 'check' : 'alert'} size={16} />
          <span>{report.reason || plan.rationale}</span>
        </div>

        <div className="card card--pad stack" style={{ gap: 8, background: 'var(--panel-2)' }}>
          <SectionTitle title="چطور وصل می‌شود" hint={STRATEGY_HINT[plan.strategy]} />
          <ol className="plan-steps">
            {plan.steps.map((step, index) => <li key={index}>{step}</li>)}
          </ol>
          {plan.entry ? (
            <div className="row row--between" style={{ fontSize: 11.5 }}>
              <span className="muted">ورودی ابزار</span>
              <span className="code">{plan.entry}</span>
            </div>
          ) : null}
          {plan.demoArguments ? (
            <div className="row row--between" style={{ fontSize: 11.5 }}>
              <span className="muted">نمونهٔ اجرا</span>
              <span className="code">{`${plan.command} ${plan.entry ?? ''} ${plan.demoArguments}`.replace(/\s+/g, ' ').trim()}</span>
            </div>
          ) : null}
          <div className="row row--wrap" style={{ gap: 5 }}>
            <span className={`badge ${plan.permissions.network ? 'badge--warn' : ''}`}>{plan.permissions.network ? 'نیاز به شبکه' : 'بدون شبکه'}</span>
            <span className={`badge ${plan.permissions.projectWrite ? 'badge--warn' : ''}`}>{plan.permissions.projectWrite ? 'نوشتن در پروژه' : 'فقط خواندن'}</span>
            {plan.permissions.environment.map((name) => <span key={name} className="badge">env: {name}</span>)}
            {plan.needsDependencies ? <span className="badge badge--info">نیاز به نصب وابستگی</span> : null}
            <span className="badge">سقف زمان: {fa(plan.timeoutSeconds)} ثانیه</span>
          </div>
        </div>

        {plan.inputs.length > 0 ? (
          <div>
            <SectionTitle title="فیلدهایی که برنامه می‌سازد" hint="در صفحهٔ ابزارها قابل تکمیل‌اند" />
            <div className="stack" style={{ gap: 5 }}>
              {plan.inputs.map((input) => (
                <div key={input.key} className="finding">
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12 }}>{input.label} {input.required ? <span className="badge badge--danger" style={{ fontSize: 9 }}>الزامی</span> : null}</div>
                    {input.help ? <div className="muted" style={{ fontSize: 10.5 }}>{input.help}</div> : null}
                  </div>
                  <span className="code">{input.type}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {report.ai ? (
          <div>
            <SectionTitle title="حکم امنیتی هوش مصنوعی" hint={report.ai.verdict} />
            <div className="alert alert--info"><Icon name="cpu" size={15} /><span>{report.ai.summary}</span></div>
            {report.ai.capabilities.length > 0 ? (
              <div className="row row--wrap" style={{ gap: 5, marginTop: 6 }}>
                {report.ai.capabilities.map((capability) => <span key={capability} className="badge">{capability}</span>)}
              </div>
            ) : null}
          </div>
        ) : null}

        <Findings findings={report.findings} />

        {!outcome && plan.actionable ? (
          <div className="stack" style={{ gap: 8 }}>
            {needsForce ? (
              <label className="checkbox" style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 9, background: 'var(--danger-soft)' }}>
                <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
                <span>ریسک این مخزن بالاست و مسئولیت اجرای آن را می‌پذیرم.</span>
              </label>
            ) : null}
            {plan.needsDependencies && plan.strategy === 'local-node' ? (
              <label className="checkbox" style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 9 }}>
                <input type="checkbox" checked={withDependencies} onChange={(event) => setWithDependencies(event.target.checked)} />
                <span>وابستگی‌های npm در همان لحظهٔ اتصال نصب شوند (<span className="code">--ignore-scripts</span>).</span>
              </label>
            ) : null}
          </div>
        ) : null}

        {outcome ? <ConnectResult result={outcome} activeProjectId={activeProjectId} toast={toast} /> : null}

        <div className="alert"><Icon name="shield" size={15} /><span>اجرای ابزار در همان کاربرِ برنامه انجام می‌شود. برای مخزن‌های ناشناس، محیط جدا (VM) استفاده کن.</span></div>
      </div>
    </Modal>
  )
}

function ConnectResult({
  result,
  activeProjectId,
  toast
}: {
  result: ToolConnectResult
  activeProjectId: string | null
  toast: ReturnType<typeof useApp.getState>['toast']
}): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string | number | boolean>>({})
  const [running, setRunning] = useState(false)
  const [runOutput, setRunOutput] = useState<PluginRunResult | null>(null)
  const [pickTarget, setPickTarget] = useState<string | null>(null)

  const inputs = useMemo(() => (result.plugin ? result.report.connect.inputs : []), [result])

  const pick = async (input: PluginInput): Promise<void> => {
    if (input.type === 'folder') {
      const folder = await unwrap(window.webforge.app.pickFolder('انتخاب پوشه'))
      if (folder) setValues((prev) => ({ ...prev, [input.key]: folder }))
      return
    }
    if (input.type === 'file') {
      const file = await unwrap(window.webforge.app.pickFile('any'))
      if (file) setValues((prev) => ({ ...prev, [input.key]: file }))
    }
  }

  const run = async (): Promise<void> => {
    if (!result.plugin) return
    setRunning(true)
    try {
      setRunOutput(await unwrap(window.webforge.plugins.run(result.plugin.id, activeProjectId, values)))
    } catch (error) {
      toast('error', 'اجرای آزمایشی ناموفق بود', errorMessage(error))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="card card--pad stack" style={{ gap: 10, border: '1px solid var(--success)' }}>
      <SectionTitle title="اتصال انجام شد" hint={result.strategy} />
      <div className="stack" style={{ gap: 4 }}>
        {result.logs.map((line, index) => <div key={index} style={{ fontSize: 11.5 }}>{line}</div>)}
        {result.installedTo ? <div className="path">{result.installedTo}</div> : null}
      </div>

      {result.project ? null : (
        <div className="stack" style={{ gap: 8 }}>
          <SectionTitle title="اجرای آزمایشی" hint="قبل از استفادهٔ جدی، یک بار اجرا کن" />
          {inputs.length === 0 ? <div className="muted" style={{ fontSize: 11.5 }}>این ابزار ورودی نمی‌خواهد.</div> : null}
          <div className="grid grid--2" style={{ gap: 8 }}>
            {inputs.map((input) => (
              <label key={input.key} className="field">
                <span className="field__label">{input.label}</span>
                {input.type === 'boolean' ? (
                  <input type="checkbox" checked={values[input.key] === true} onChange={(event) => setValues((prev) => ({ ...prev, [input.key]: event.target.checked }))} />
                ) : input.type === 'select' ? (
                  <select className="select" value={String(values[input.key] ?? '')} onChange={(event) => setValues((prev) => ({ ...prev, [input.key]: event.target.value }))}>
                    <option value="">—</option>
                    {(input.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                ) : input.type === 'textarea' ? (
                  <textarea className="textarea" value={String(values[input.key] ?? '')} onChange={(event) => setValues((prev) => ({ ...prev, [input.key]: event.target.value }))} />
                ) : (
                  <div className="row" style={{ gap: 5 }}>
                    <input
                      className="input input--ltr"
                      style={{ flex: 1 }}
                      type={input.type === 'number' ? 'number' : 'text'}
                      placeholder={input.placeholder ?? ''}
                      value={String(values[input.key] ?? '')}
                      onChange={(event) => setValues((prev) => ({ ...prev, [input.key]: event.target.value }))}
                    />
                    {['folder', 'file'].includes(input.type) ? <Button size="sm" variant="ghost" icon="folder" loading={pickTarget === input.key} onClick={() => { setPickTarget(input.key); void pick(input).finally(() => setPickTarget(null)) }} aria-label="انتخاب" /> : null}
                  </div>
                )}
                {input.help ? <span className="muted" style={{ fontSize: 10.5 }}>{input.help}</span> : null}
              </label>
            ))}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" variant="primary" icon="play" loading={running} onClick={() => void run()}>اجرای آزمایشی</Button>
            {activeProjectId ? <span className="muted" style={{ fontSize: 11 }}>روی پروژهٔ فعال اجرا می‌شود</span> : <span className="badge badge--warn">پروژه‌ای انتخاب نشده</span>}
          </div>
          {runOutput ? (
            <pre className="log" style={{ maxHeight: 220 }}>
              {`exit: ${runOutput.run.exitCode ?? '—'}  status: ${runOutput.run.status}\n${runOutput.logs.slice(-6000)}`}
            </pre>
          ) : null}
        </div>
      )}
    </div>
  )
}

function Findings({ findings }: { findings: NonNullable<ToolConnectResult['report']>['findings'] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const counts = {
    critical: findings.filter((item) => item.severity === 'critical').length,
    warning: findings.filter((item) => item.severity === 'warning').length
  }
  return (
    <div>
      <button className="row" style={{ gap: 8, color: 'var(--muted)', fontSize: 11.5 }} onClick={() => setOpen((value) => !value)}>
        <Icon name="chevron" size={13} style={{ transform: open ? 'rotate(-90deg)' : 'none' }} />
        یافته‌های بازرسی
        {counts.critical > 0 ? <span className="badge badge--danger">{fa(counts.critical)} بحرانی</span> : null}
        {counts.warning > 0 ? <span className="badge badge--warn">{fa(counts.warning)} هشدار</span> : null}
        {counts.critical + counts.warning === 0 ? <span className="badge badge--success">پاک</span> : null}
      </button>
      {open ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', maxHeight: 240, overflowY: 'auto', marginTop: 6 }}>
          {findings.map((finding, index) => (
            <div key={index} className="finding">
              <span className={`finding__sev ${finding.severity === 'critical' ? 'finding__sev--critical' : finding.severity === 'warning' ? 'finding__sev--major' : ''}`} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12 }}>{finding.message}</div>
                {finding.file ? <div className="path" style={{ marginTop: 2 }}>{finding.file}</div> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function RiskBadge({ level }: { level: 'low' | 'medium' | 'high' }): React.JSX.Element {
  return (
    <span className={`badge ${level === 'high' ? 'badge--danger' : level === 'medium' ? 'badge--warn' : 'badge--success'}`}>
      ریسک {level === 'high' ? 'بالا' : level === 'medium' ? 'متوسط' : 'کم'}
    </span>
  )
}

function Stepper({ step }: { step: 1 | 2 | 3 | 4 }): React.JSX.Element {
  const labels = ['جستجو', 'بازرسی', 'طرح اتصال', 'نتیجه']
  return (
    <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      {labels.map((label, index) => {
        const order = (index + 1) as 1 | 2 | 3 | 4
        const state = order < step ? 'done' : order === step ? 'current' : 'todo'
        return (
          <div key={label} className="row" style={{ gap: 6, alignItems: 'center' }}>
            <span className={`badge ${state === 'current' ? 'badge--accent' : state === 'done' ? 'badge--success' : ''}`}>
              {state === 'done' ? '✓' : fa(order)} {label}
            </span>
            {index < labels.length - 1 ? <span className="muted" style={{ fontSize: 11 }}>←</span> : null}
          </div>
        )
      })}
    </div>
  )
}
