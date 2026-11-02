const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']

export function fa(value: string | number): string {
  return String(value).replace(/\d/g, (digit) => persianDigits[Number(digit)])
}

export function number(value: number): string {
  return fa(new Intl.NumberFormat('en-US').format(value))
}

export function bytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '۰ B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  const formatted = size >= 100 ? Math.round(size).toString() : size.toFixed(1)
  return `${fa(formatted)} ${units[unit]}`
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${fa(Math.round(ms))} میلی‌ثانیه`
  if (ms < 60_000) return `${fa((ms / 1000).toFixed(1))} ثانیه`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${fa(minutes)} دقیقه و ${fa(seconds)} ثانیه`
}

export function date(value: string | null | undefined): string {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      calendar: 'persian',
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value))
  } catch {
    return value
  }
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('fa-IR', { calendar: 'persian', dateStyle: 'medium' }).format(new Date(value))
  } catch {
    return value
  }
}

export function timeAgo(value: string | null | undefined): string {
  if (!value) return '—'
  const diff = Date.now() - new Date(value).getTime()
  if (diff < 60_000) return 'همین حالا'
  if (diff < 3_600_000) return `${fa(Math.floor(diff / 60_000))} دقیقه پیش`
  if (diff < 86_400_000) return `${fa(Math.floor(diff / 3_600_000))} ساعت پیش`
  return `${fa(Math.floor(diff / 86_400_000))} روز پیش`
}

export function percent(value: number, total: number): string {
  if (total <= 0) return '۰٪'
  return `${fa(Math.min(100, Math.round((value / total) * 100)))}٪`
}

export function truncate(value: string, length = 80): string {
  if (value.length <= length) return value
  return `${value.slice(0, length)}…`
}
