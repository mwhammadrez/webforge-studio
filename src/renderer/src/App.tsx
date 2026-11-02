import { useEffect } from 'react'
import { useApp, type Route } from './store'
import { Icon, type IconName } from './components/Icon'
import { Spinner } from './components/ui'
import { unwrap, errorMessage } from './lib/api'
import Dashboard from './pages/Dashboard'
import Extract from './pages/Extract'
import Projects from './pages/Projects'
import Workspace from './pages/Workspace'
import Qa from './pages/Qa'
import Plugins from './pages/Plugins'
import AiBuilder from './pages/AiBuilder'
import Discover from './pages/Discover'
import Settings from './pages/Settings'

const NAV: Array<{ route: Route; label: string; icon: IconName; group: string }> = [
  { route: 'dashboard', label: 'خانه', icon: 'home', group: 'فضای کاری' },
  { route: 'extract', label: 'استخراج سایت', icon: 'download', group: 'فضای کاری' },
  { route: 'projects', label: 'پروژه‌ها', icon: 'folder', group: 'فضای کاری' },
  { route: 'workspace', label: 'ویرایشگر بصری', icon: 'edit', group: 'فضای کاری' },
  { route: 'qa', label: 'تستر سایت', icon: 'shield', group: 'کیفیت' },
  { route: 'plugins', label: 'ابزارها', icon: 'layers', group: 'کیفیت' },
  { route: 'ai', label: 'ساخت با هوش مصنوعی', icon: 'sparkles', group: 'ساخت' },
  { route: 'discover', label: 'کشف ابزار', icon: 'github', group: 'ساخت' },
  { route: 'settings', label: 'تنظیمات', icon: 'settings', group: 'برنامه' }
]

export default function App(): React.JSX.Element {
  const { ready, route, init, settings, preview, activeProject, sidebarCollapsed } = useApp()
  const navigate = useApp((state) => state.navigate)
  const toggleSidebar = useApp((state) => state.toggleSidebar)
  const toasts = useApp((state) => state.toasts)
  const dismissToast = useApp((state) => state.dismissToast)
  const refreshSettings = useApp((state) => state.refreshSettings)
  const toast = useApp((state) => state.toast)

  useEffect(() => {
    void init()
  }, [init])

  const toggleTheme = async (): Promise<void> => {
    if (!settings) return
    const next = settings.theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      await unwrap(window.webforge.settings.update({ theme: next }))
      await refreshSettings()
    } catch (error) {
      toast('error', 'تغییر تم ناموفق بود', errorMessage(error))
    }
  }

  if (!ready || !settings) {
    return (
      <div className="app-shell">
        <div style={{ display: 'grid', placeItems: 'center', height: '100vh', gap: 12 }}>
          <div className="row" style={{ color: 'var(--muted)' }}>
            <Spinner />
            در حال بارگذاری فضای کاری…
          </div>
        </div>
      </div>
    )
  }

  const project = activeProject()
  const groups = [...new Set(NAV.map((item) => item.group))]

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="titlebar__brand">
          <span className="titlebar__logo">W</span>
          <span>WebForge Studio</span>
          <span className="titlebar__meta">استودیوی سایت</span>
          {project ? (
            <span className="badge badge--accent" style={{ marginInlineStart: 8 }}>
              <Icon name="folder" size={12} /> {project.name}
            </span>
          ) : null}
        </div>
        <div className="row" style={{ gap: 2, height: '100%' }}>
          <button
            className="win-btn"
            onClick={() => void toggleTheme()}
            title={settings.theme === 'dark' ? 'تم روشن' : 'تم تیره'}
            style={{ width: 42 }}
          >
            <Icon name={settings.theme === 'dark' ? 'sparkles' : 'palette'} size={16} />
          </button>
          <div className="titlebar__controls">
            <button className="win-btn" onClick={() => window.webforge.window.minimize()} aria-label="کوچک‌کردن">
              <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" /></svg>
            </button>
            <button className="win-btn" onClick={() => window.webforge.window.maximize()} aria-label="بزرگ‌کردن">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1.2" y="1.2" width="7.6" height="7.6" stroke="currentColor" strokeWidth="1.1" /></svg>
            </button>
            <button className="win-btn win-btn--close" onClick={() => window.webforge.window.close()} aria-label="بستن">
              <svg width="10" height="10" viewBox="0 0 10 10"><path d="m1.5 1.5 7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.2" /></svg>
            </button>
          </div>
        </div>
      </header>
      <div className="workarea" data-collapsed={sidebarCollapsed}>
        <aside className="sidebar">
          <button className="nav__item" onClick={toggleSidebar} title="جمع/باز کردن نوار">
            <Icon name={sidebarCollapsed ? 'menu' : 'panel'} size={17} />
            {!sidebarCollapsed ? <span className="nav__label">جمع کردن نوار</span> : null}
          </button>
          {groups.map((group) => (
            <div key={group}>
              <div className="sidebar__section-label">{group}</div>
              <nav className="nav">
                {NAV.filter((item) => item.group === group).map((item) => (
                  <button
                    key={item.route}
                    className="nav__item"
                    data-active={route === item.route}
                    onClick={() => navigate(item.route)}
                    title={item.label}
                  >
                    <Icon name={item.icon} size={17} />
                    {!sidebarCollapsed ? <span className="nav__label">{item.label}</span> : null}
                    {!sidebarCollapsed && item.route === 'workspace' && preview?.running ? (
                      <span className="status-dot status-dot--on" style={{ marginInlineStart: 'auto' }} />
                    ) : null}
                  </button>
                ))}
              </nav>
            </div>
          ))}
          <div className="sidebar__spacer" />
          <div className="sidebar__status">
            <div className="row row--between">
              <span>پیش‌نمایش</span>
              <span>
                <span className={`status-dot ${preview?.running ? 'status-dot--on' : ''}`} />
                {preview?.running ? 'فعال' : 'خاموش'}
              </span>
            </div>
            <div className="row row--between">
              <span>هوش مصنوعی</span>
              <span>
                <span className={`status-dot ${settings.aiKeyConfigured ? 'status-dot--on' : ''}`} />
                {settings.aiKeyConfigured ? 'آماده' : 'تنظیم نشده'}
              </span>
            </div>
          </div>
        </aside>
        <main className="main">
          {route === 'dashboard' ? <Dashboard /> : null}
          {route === 'extract' ? <Extract /> : null}
          {route === 'projects' ? <Projects /> : null}
          {route === 'workspace' ? <Workspace /> : null}
          {route === 'qa' ? <Qa /> : null}
          {route === 'plugins' ? <Plugins /> : null}
          {route === 'ai' ? <AiBuilder /> : null}
          {route === 'discover' ? <Discover /> : null}
          {route === 'settings' ? <Settings /> : null}
        </main>
      </div>
      <div className="toasts">
        {toasts.map((item) => (
          <div key={item.id} className={`toast toast--${item.type}`} onClick={() => dismissToast(item.id)}>
            <div className="toast__title">{item.title}</div>
            {item.message ? <div className="toast__msg">{item.message}</div> : null}
          </div>
        ))}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
