export class AppError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return new AppError('NOT_FOUND', 'فایل یا مسیر موردنظر پیدا نشد.', 404)
    if (code === 'EACCES' || code === 'EPERM')
      return new AppError('PERMISSION_DENIED', 'دسترسی به این مسیر مجاز نیست.', 403)
    if (code === 'ENOSPC') return new AppError('DISK_FULL', 'فضای دیسک کافی نیست.', 507)
    return new AppError('INTERNAL', error.message, 500)
  }
  return new AppError('INTERNAL', 'خطای ناشناخته رخ داد.', 500)
}
