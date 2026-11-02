import { useEffect, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { fa, percent } from '../lib/format'

export function Spinner({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '2px solid currentColor',
        borderTopColor: 'transparent',
        display: 'inline-block',
        animation: 'spin .8s linear infinite'
      }}
    />
  )
}

export function Button({
  children,
  variant = 'default',
  size,
  icon,
  loading,
  className = '',
  ...props
}: {
  children?: ReactNode
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'sm'
  icon?: IconName
  loading?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button
      type="button"
      className={`btn ${variant !== 'default' ? `btn--${variant}` : ''} ${size ? `btn--${size}` : ''} ${className}`}
      {...props}
      disabled={props.disabled || loading}
    >
      {loading ? <Spinner size={14} /> : icon ? <Icon name={icon} size={15} /> : null}
      {children}
    </button>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
  required
}: {
  label: string
  hint?: string
  error?: string | null
  children: ReactNode
  required?: boolean
}): React.JSX.Element {
  return (
    <label className="field">
      <span className="field__label">
        {label}
        {required ? <span style={{ color: 'var(--accent)' }}>*</span> : null}
      </span>
      {children}
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  )
}

export function Progress({ value, total, indeterminate }: { value: number; total: number; indeterminate?: boolean }): React.JSX.Element {
  const width = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
  return (
    <div>
      <div className="progress">
        <div
          className={`progress__bar ${indeterminate ? 'progress__bar--indeterminate' : ''}`}
          style={{ width: `${indeterminate ? 35 : width}%` }}
        />
      </div>
      {!indeterminate && total > 0 ? (
        <div className="row row--between" style={{ marginTop: 5, fontSize: 11, color: 'var(--muted)' }}>
          <span>
            {fa(value)} از {fa(total)}
          </span>
          <span>{percent(value, total)}</span>
        </div>
      ) : null}
    </div>
  )
}

export function Empty({
  icon = 'folder',
  title,
  description,
  action
}: {
  icon?: IconName
  title: string
  description?: string
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon name={icon} size={24} />
      </div>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  )
}

export function Modal({
  title,
  children,
  footer,
  onClose,
  width
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  width?: number
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={width ? { width: `min(${width}px, 100%)` } : undefined} role="dialog" aria-modal="true">
        <div className="modal__head">
          <h3>{title}</h3>
          <button className="btn btn--ghost btn--icon" onClick={onClose} aria-label="بستن">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Confirm({
  title,
  message,
  confirmLabel = 'تأیید',
  danger,
  onConfirm,
  onClose
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            انصراف
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ fontSize: 13, lineHeight: 1.9, color: 'var(--text-soft)' }}>{message}</div>
    </Modal>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange
}: {
  tabs: Array<{ value: T; label: string; badge?: string | number }>
  value: T
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          className="tab"
          data-active={tab.value === value}
          onClick={() => onChange(tab.value)}
          role="tab"
        >
          {tab.label}
          {tab.badge !== undefined ? <span className="nav__badge" style={{ marginInlineStart: 6 }}>{fa(tab.badge)}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function SectionTitle({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }): React.JSX.Element {
  return (
    <div className="section-title">
      <div>
        <h3>{title}</h3>
        {hint ? <div className="section-title__hint">{hint}</div> : null}
      </div>
      {action}
    </div>
  )
}

export function KeyValue({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }): React.JSX.Element {
  return (
    <div className="row row--between" style={{ gap: 16, padding: '5px 0', fontSize: 12 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span className={mono ? 'mono' : ''} style={{ textAlign: 'end', wordBreak: 'break-word' }}>
        {value}
      </span>
    </div>
  )
}

export function statusBadge(status: string | null | undefined): React.JSX.Element {
  const map: Record<string, { label: string; cls: string }> = {
    ready: { label: 'آماده', cls: 'badge--success' },
    extracting: { label: 'در حال استخراج', cls: 'badge--info' },
    partial: { label: 'با هشدار', cls: 'badge--warn' },
    error: { label: 'خطا', cls: 'badge--danger' },
    archived: { label: 'آرشیو', cls: '' },
    success: { label: 'موفق', cls: 'badge--success' },
    failed: { label: 'ناموفق', cls: 'badge--danger' },
    running: { label: 'در حال اجرا', cls: 'badge--info' },
    queued: { label: 'در صف', cls: '' },
    cancelled: { label: 'لغو‌شده', cls: 'badge--warn' },
    timeout: { label: 'پایان زمان', cls: 'badge--warn' }
  }
  const item = map[status ?? ''] ?? { label: status ?? '—', cls: '' }
  return <span className={`badge ${item.cls}`}>{item.label}</span>
}
