# BASELINE REPORT — محیط ساخت

تاریخ: ۲۰۲۶-۱۱-۰۲ · وضعیت: **اجرا در Linux sandbox** (ویندوز در دسترس نبود)

## محیط

| مورد | مقدار |
|---|---|
| OS | Linux 6.1.158 x86_64 |
| CPU / RAM | 4 vCPU / ~3.9GB |
| Node | v24.18.0 (سیستم) |
| npm | 11.16.0 |
| Electron | 45.2.1 |
| Node داخل Electron | 24.22.1 |
| Chromium داخل Electron | 156.0.8078.75 |
| Python | 3.10.12 |
| Git | 2.34.1 |
| Display | Xvfb (headless) |
| Wine | ❌ نصب نیست |

## بررسی‌های انجام‌شده

| بررسی | نتیجه |
|---|---|
| `node:sqlite` در Electron | ✅ `SQLITE_OK` با `DatabaseSync` on `:memory:` |
| اجرای Electron با preload سندباکس‌شده | ✅ پنجره و داشبورد فارسی بالا آمد |
| `npm install` | ✅ ۳۸۸+ پکیج |
| `npm run typecheck` | ✅ بدون خطا |
| `npm run build` | ✅ main/preload/renderer |
| `npm run verify` | ✅ (25 تست + gate + build) |
| Playwright `_electron` | ✅ ۶ سناریو |
| electron-builder Linux dir | ✅ |
| electron-builder Windows portable | ✅ (NSIS stub + app-64.7z) |
| electron-builder Windows NSIS | ❌ `spawn wine ENOENT` برای uninstaller |
| Gofile download | ❌ notPremium → rateLimit → TLS reset |

## وابستگی‌های تأییدشده

`electron@45.2.1`, `electron-vite@6.0.0`, `vite@8.3.5`, `react@19.3.1`, `react-dom@19.3.1`, `typescript@5.9.3`, `vitest@5.0.5`, `zod@4.6.7`, `zustand@5.0.16`, `cheerio@1.2.0`, `postcss@8.5.32`, `chokidar@4.0.3`, `mime-types@3.0.2`, `axe-core@4.14.0`, `playwright-core@1.64.1`, `@playwright/test@1.64.1`, `electron-builder@26.18.0`.

## انحراف‌ها از پرامپت اصلی

| پرامپت | واقعیت | تصمیم |
|---|---|---|
| Windows 10/11 | Linux sandbox | بیلد cross-platform؛ بستهٔ ویندوز ساخته شد اما اجرای واقعی تأیید نشد |
| Tailwind CSS | CSS سفارشی | کنترل RTL/تم/باندل بهتر؛ در DECISIONS |
| better-sqlite3/SQLite | `node:sqlite` | بدون native rebuild؛ رفتار SQL یکسان |
| Playwright E2E + Electron | انجام شد | ✅ |
| `npm run package:win` | portable فقط | NSIS نیاز به Wine داشت |
| گیت‌هاب برای هر ابزار | انجام شد | لینک‌ها در RESEARCH_GITHUB |

## ریسک‌های محیط

- نبود ویندوز/Defender برای تست نهایی.
- نبود keyring در Linux → `safeStorage` ممکن است کلید را ذخیره نکند؛ روی ویندوز DPAPI موجود است.
- IP دیتاسنتر برای Gofile بلاک شد.
- فونت فارسی از npm/CDN گرفته شد و لوکال بسته شد.
