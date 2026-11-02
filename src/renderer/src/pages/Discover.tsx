import { useState } from 'react'
import type { GithubRepoDetail, GithubRepoSummary } from '@shared/types'
import { Button, Empty, Modal, SectionTitle } from '../components/ui'
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
              <Button icon="external" onClick={() => void window.webforge.app.openExternal(selected.htmlUrl)}>باز کردن در GitHub</Button>
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
    </div>
  )
}
