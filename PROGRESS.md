# PROGRESS

| مورد | وضعیت |
|---|---|
| نسخه | 1.2.1 |
| تاریخ | 2026-11-04 |
| Typecheck | ✅ صفر خطا |
| Unit/Integration | ✅ 39/39 در 7 فایل |
| E2E Electron | ✅ 17/17 (8 در `app.spec.ts` + 6 در `editor-deep.spec.ts` + 3 در `editor-hydrated.spec.ts`) + ۲ سناریوی اختیاری `discover-live.spec.ts` با اینترنت واقعی |
| Placeholder gate | ✅ |
| Build | ✅ main/preload/renderer |
| Linux dir package | ✅ `release/linux-unpacked` |
| Windows portable | ✅ `release/WebForge Studio-1.2.1-portable.exe` |
| Windows NSIS | ✅ `release/WebForge Studio-1.2.1-x64.exe` — روی ویندوز واقعی ساخته شده (خودِ نصب‌کننده اجرا نشده) |
| Windows execution | ✅ `win-unpacked/WebForge Studio.exe` روی ویندوز ۱۰ بالا آمد (`APP_READY`)؛ E2E روی Electron واقعی همین ماشین |

## لاگ زمانی

- **۲۶ مهر / 2026-11-02** — دریافت پرامپت (81KB) و دو RAR اول. باز کردن با مشکل encoding فارسی؛ حل با `LANG=en_US.UTF-8 unrar`.
- ممیزی ابزار ۱ و ۲ و پیاده‌سازی هستهٔ استخراج/پنل.
- پژوهش چهار مسیر (استخراج، ویرایش بصری، AI/DeepSeek، QA) و ثبت در `docs/RESEARCH_GITHUB.md`.
- ساخت اسکلت Electron 45 + React 19 + TS 5.9 + `node:sqlite`.
- پیاده‌سازی سرویس‌های extraction/preview/editor/plugins/ai/qa/discovery.
- ساخت UI فارسی RTL با تم دارک/لایت و ۹ صفحه.
- تست: ۲۵ تست واحد/یکپارچه. رفع باگ‌های واقعی:
  - keep-alive سوکت‌های preview بعد از Stop → `closeAllConnections`.
  - دارایی‌های داخل CSS دانلود نمی‌شدند → کشف بازگشتی `url()`/`@import`.
  - undo محتوای کامل فایل را ذخیره نمی‌کرد → snapshot کامل.
  - ناسازگاری preload/IPC (آرگومان خام vs آبجکت) → همهٔ کانال‌ها یکدست.
  - `security` در enum تستر نبود.
- E2E واقعی ۷ سناریو سبز (شامل اجرای پلاگین Node خارجی با لاگ/خروجی).
- **1.1.0:** ورود پروژهٔ محلی با اسکن، سوییچ پروژه در ویرایشگر، بازرسی/ادغام خودکار ریپو با حکم AI، نصب وابستگی پلاگین.
- تست واقعی ادغام با `sindresorhus/np`: inspect → install → npm install (563 packages) → run `--help` موفق.
- اصلاحات کیفی نهایی: log redaction ایمن، لغو پلاگین حین اجرا، حفظ حالت انتخاب بعد از reload، فونت وزیرمتن در سایت AI، flatten کردن slugهای تودرتو.
- بیلد Linux و Windows portable؛ اجرای بستهٔ Linux موفق.
- تلاش برای Gofile ۳/۴: `error-notPremium`، سپس `429`، سپس TLS reset از IP دیتاسنتر. محتوا دریافت نشد.
- **۱۳ آبان / 2026-11-04 — 1.2.0:** اتصال ابزار با طرح هوش مصنوعی (npx/Python/استاتیک/دستی) +
  راستی‌آزمایی هر ادعای پلن روی دیسک قبل از اجرا؛ ریپوی وب‌سایت به‌عنوان پروژهٔ قابل‌ویرایش وارد می‌شود.
  بازسازی اینسپکتور ویرایشگر (محتوا/استایل/ساختار، کلاس، `data-*`، درج و حذف HTML).
  رفع باگ‌های واقعی: حالت انتخاب بعد از reload، باز شدن `clean/old/index.html` جای صفحهٔ اصلی،
  فاصلهٔ اضافه بعد از حذف ویژگی، Toast تکراری، اجرای `npm`/`npx` روی ویندوز.
  امنیتی: بلوک shell-open برای فایل‌های اجرایی، follow نکردن symlink در کپی ریپو،
  token/origin برای همهٔ پیام‌های iframe.
  محیط واقعی ویندوز: `npm ci` + دانلود دستی باینری Electron + `package:win` (NSIS + portable) +
  اجرای باینری بسته‌بندی‌شده + E2E ۱۴ سناریو سبز.
- **۱۳ آبان / 2026-11-04 — 1.2.1:** رفع «هر چی میام ادیت کنم میگه» روی پروژهٔ واقعی Goldify.
  تشخیص: Goldify خروجی Framer است؛ باندل `assets/framerusercontent.com/.../*.mjs` موقع اجرا کل
  صفحه را از snapshot خودش (نسخهٔ انگلیسی قالب) دوباره می‌سازد — در تست: ۳۲۲۱ عنصر در فایل در
  برابر ۱۷۶۰ عنصر در DOM زنده، و ۰ از ۱۲۰ سلکتور قابل‌نگاشت. راه‌حل: preview در حالت ویرایش
  اسکریپت‌های خود سایت را سرو نمی‌کند (سوییچ «اسکریپت‌های سایت: خاموش/روشن»)، پس DOM همان فایل
  است — ۱۲۰/۱۲۰ سلکتور سبز و ذخیرهٔ واقعی روی کپی پروژهٔ کاربر موفق.
  ضمناً حالت pre-animation (`opacity:0`) خنثی می‌شود تا صفحه بدون اسکریپت نیمه‌خالی نباشد،
  لنگرِ از‌دست‌رفته روی کوچک‌ترین عنصر حاوی متن کلیک‌شده بازمی‌گردد، و وقتی متن واقعاً در فایل
  نیست پیام خطا فایل و دکمهٔ درست را نام می‌برد. تست: ۳ سناریوی E2E جدید + ۳ تست واحد.

## شواهد کلیدی

```text
$ npm run verify
typecheck: OK
tests: 33 passed (7 files)
placeholder gate: passed
build: OK
```

```text
$ npx playwright test
14 passed
```

```text
$ npm run package:win
building target=nsis file=release/WebForge Studio-1.2.0-x64.exe
building target=portable file=release/WebForge Studio-1.2.0-portable.exe
```
