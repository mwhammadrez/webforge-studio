# SPEC — WebForge Studio

نسخهٔ ۱.۰ · تاریخ ۲۰۲۶-۱۱-۰۲ · منبع اصلی: `docs/prompt.txt`

این سند مشخصات نرمال‌شده و **وضعیت واقعی پیاده‌سازی** را کنار هم نگه می‌دارد. ادعای «کامل» فقط جایی است که تست یا اجرای واقعی دارد.

## ۱. هدف و کاربر

- کاربر: یک طراح سایت حرفه‌ای، تک‌کاربره، روی ویندوز ۱۰/۱۱.
- ارزش اصلی: یک فضای کاری محلی برای استخراج، ویرایش، ساخت و تست سایت، به‌جای مجموعه‌ای از اسکریپت‌ها.
- زبان: فارسی RTL؛ نام فایل/کد/URL انگلیسی.
- داده: محلی. فقط DeepSeek با کلید کاربر و تأیید پلن صدا زده می‌شود.

## ۲. معماری

```text
Renderer (React 19, RTL) ── contextBridge ── Preload (allowlist)
        │
Main process (Electron 45)
  ├─ ProjectService      SQLite/node:sqlite
  ├─ ExtractionService   fetch + cheerio + postcss + Chromium rendered mode
  ├─ PreviewService      http server + SSE + editor injection + admin API
  ├─ EditorService       parse5 offsets (cheerio) + surgical patch + backup
  ├─ PluginService       manifest + child_process + logs + timeout
  ├─ AiService           DeepSeek plan/SSE generation
  ├─ QaService           hidden BrowserWindow + axe-core
  └─ DiscoveryService    GitHub REST
```

مرز اعتماد: renderer هیچ Node/FS/child-process/secret ندارد. همهٔ IPCها با Zod در main اعتبارسنجی می‌شوند.

## ۳. نیازمندی‌های کارکردی و وضعیت

| گروه | نیازمندی | وضعیت | شاهد |
|---|---|---|---|
| پوسته | داشبورد فارسی RTL، تم دارک/لایت/سیستم، بازیابی تم و اندازه پنجره | ✅ | `tests/e2e` تست ۱ و ۶ |
| پوسته | تنظیم مسیر پروژه، پورت، AI، محدودیت استخراج | ✅ | صفحهٔ تنظیمات + `SettingsService` |
| پروژه | ساخت/باز کردن/فهرست/تغییر نام/حذف به سبد بازیابی/درخت فایل/تشخیص نوع | ✅ | `Projects.tsx`, `ProjectService`, E2E تست ۲–۳ |
| پروژه | ورود پوشهٔ محلی با اسکن و گزارش، نمایش در ویرایشگر و تستر | ✅ | `Projects.tsx` scan modal, E2E تست ۸ |
| پروژه | اجرای اسکریپت dev پروژه‌های Node با تأیید | ❌ | فقط تشخیص و نمایش؛ پیش‌نمایش استاتیک است |
| استخراج | URL عمومی، SSRF، robots، عمق/تعداد/حجم/زمان، لغو، هشدار، مانیفست | ✅ | `tests/extraction.test.ts`, `tests/url-guard.test.ts` |
| استخراج | بازنویسی HTML/CSS/srcset/url() و @import | ✅ | تست استخراج (CSS bg/font) |
| استخراج | حالت رندرشده با Chromium | ✅ (کد) / ⚠️ تست E2E ندارد | `fetchRendered` |
| استخراج | assetهای خارجی اختیاری، عدم اجرای JS دانلودشده | ✅ | کد + تست |
| پیش‌نمایش | سرور محلی، پورت آزاد، توقف واقعی، رفرش زنده (SSE) | ✅ | `tests/preview.test.ts` |
| پیش‌نمایش | نمایش PID/لاگ/کرش | ⚠️ جزئی | PID نمایش داده می‌شود؛ کرش لاگ ساختاری ندارد |
| ویرایش | انتخاب عنصر، متن/عکس/لینک/استایل، پشتیبان، Undo/Redo، تاریخچه | ✅ | `tests/editor.test.ts`, E2E تست ۳ |
| ویرایش | نگاشت منبع برای DOM پویا | ⚠️ | warning و fallback متنی؛ بدون source map |
| ویرایش | جایگزینی تصویر با اعتبارسنجی محتوا و حجم | ✅ | `detectImage` + ۱۰MB |
| ابزارها | مانیفست Zod، فرم خودکار، اجرا، لاگ، خروجی، تایم‌اوت، لغو، مجوز، نصب وابستگی | ✅ | `plugins.ts`, `manifest.test.ts`, E2E تست ۴–۵ |
| ابزارها | محیط ایزوله/شبکهٔ کاملاً مسدود | ⚠️ best-effort | env allowlist + پروکسی نامعتبر؛ sandbox OS ندارد |
| AI | پلن، تأیید، تولید کامل، پیشرفت، لغو، خطاهای کلید/شبکه | ✅ | `tests/ai.test.ts` با سرور جعلی |
| AI | Resume خودکار پس از خطا | ❌ | فایل‌های قبلی حفظ می‌شوند؛ ساخت دوباره پروژهٔ جدید می‌سازد |
| AI | محدودیت خروجی به پوشهٔ پروژه و بازبینی قبل از overwrite | ✅ | همیشه پوشهٔ یکتا؛ بدون overwrite |
| کشف ابزار | جستجو، جزئیات، README، مجوز/ریسک/سازگاری | ✅ | `discovery.ts`, صفحهٔ کشف |
| ادغام ابزار | دانلود امن، اسکن استاتیک، حکم AI، مانیفست، افزودن به فضای کاری، نصب وابستگی | ✅ | `integration.ts`, تست واقعی `sindresorhus/np` |
| تست | HTML/لینک/a11y/SEO/کنسول/پرفورمنس/ریسپانسیو/امنیت پایه + گزارش | ✅ | `qa.ts`, E2E تست ۵ |
| داده | SQLite، مهاجرت نسخه‌دار، export JSON، reset تنظیمات | ✅ | `db.ts` |
| داده | حذف کامل همهٔ داده‌های برنامه از UI | ⚠️ | reset تنظیمات + خروجی؛ حذف کامل DB دکمه ندارد |

## ۴. نیازمندی‌های غیرکارکردی

| مورد | وضعیت |
|---|---|
| TypeScript strict + صفر خطا | ✅ `npm run typecheck` |
| بدون placeholder/TODO/test skip | ✅ `npm run check:placeholders` |
| تست واحد/یکپارچه | ✅ ۲۵ تست در ۷ فایل |
| E2E واقعی Electron | ✅ ۸ تست |
| SSRF/path confinement/secret redaction/safeStorage | ✅ |
| IPC validation | ✅ همهٔ کانال‌ها |
| CSP و جداسازی context | ✅ |
| Audit وابستگی‌ها | ⚠️ اسکریپت `audit:deps` جدا؛ در `verify` نیست (نیاز به شبکه) |
| دسترس‌پذیری خود برنامه | ⚠️ aria-label و فوکوس پایه؛ axe روی UI اجرا نشده |
| کارایی بودجه‌ای | ⚠️ اندازه‌گیری رسمی انجام نشده؛ باندل ~۸۰۰KB + فونت |
| ویندوز ۱۰/۱۱ | ⚠️ بسته ساخته شد؛ اجرای واقعی روی ویندوز در این محیط تأیید نشده |

## ۵. مدل داده

`projects`, `extraction_runs`, `plugins`, `plugin_runs`, `edit_events`, `ai_jobs`, `settings` — مطابق `src/main/core/db.ts`. مهاجرت‌ها forward-only با `PRAGMA user_version`.

قواعد:
- `projects.path` یکتا.
- `edit_events` محتوای کامل فایل قبل/بعد را برای Undo نگه می‌دارد.
- `plugin_runs` لاگ و خروجی و exit code را نگه می‌دارد.
- کلید API در جدول settings به‌صورت رمزنگاری‌شده ذخیره می‌شود.

## ۶. قرارداد Plugin

مانیفست در `src/shared/schemas.ts` تعریف شده است. انواع runtime: `node`, `python`, `executable`, `shell`, `builtin`.
ورودی‌ها به فرم فارسی تبدیل می‌شوند. `{{key}}`، `{{projectPath}}`، `{{cwd}}` جای‌گذاری می‌شوند.
خروجی‌های اعلام‌شده پس از اجرا بررسی می‌شوند.

## ۷. خطاها و مسیرهای شکست

| کد | معنا | رفتار |
|---|---|---|
| `PRIVATE_URL_NOT_ALLOWED` | SSRF | رد با پیام فارسی |
| `EXTRACTION_CANCELLED` | لغو | حفظ فایل‌ها + status partial |
| `ELEMENT_NOT_MAPPED` | نگاشت نشد | پیام و پیشنهاد بازخوانی |
| `PLUGIN_INPUT_INVALID` | ورودی ناقص | فرم و پیام فیلد |
| `PLUGIN_DISABLED` | غیرفعال | جلوگیری از اجرا |
| `AI_KEY_MISSING` | بدون کلید | راهنمای تنظیمات، بدون درخواست |
| `AI_UNAUTHORIZED` | 401 | پیام کلید |
| `NO_FREE_PORT` | پورت | پیشنهاد بازهٔ دیگر |
| `PATH_OUTSIDE_ROOT` | مسیر | رد ۴۰۳ |

## ۸. خارج از دامنهٔ این نسخه

- Multi-user/cloud sync، انتشار مستقیم روی هاست، Git داخلی، CMS دیتابیسی، موبایل، بسته‌بندی macOS.
- اجرای خودکار مخازن GitHub بدون بررسی.
- نصب‌کنندهٔ NSIS ساخته‌نشده در این محیط (نبود Wine).
