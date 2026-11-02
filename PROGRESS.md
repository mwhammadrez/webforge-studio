# PROGRESS

| مورد | وضعیت |
|---|---|
| نسخه | 1.1.0 |
| تاریخ | 2026-11-02 |
| Typecheck | ✅ صفر خطا |
| Unit/Integration | ✅ 25/25 در 7 فایل |
| E2E Electron | ✅ 8/8 |
| Placeholder gate | ✅ |
| Build | ✅ main/preload/renderer |
| Linux dir package | ✅ `release/linux-unpacked` |
| Windows portable | ✅ `release/WebForge Studio-1.0.0-portable.exe` |
| Windows NSIS | ❌ نیاز به Wine در محیط ساخت |
| Windows execution | ⚠️ در این محیط ویندوز اجرا نشده |

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

## شواهد کلیدی

```text
$ npm run verify
typecheck: OK
tests: 25 passed (7 files)
placeholder gate: passed
build: OK
```

```text
$ xvfb-run -a npx playwright test
8 passed (11.6s)
```

```text
$ npx electron-builder --win portable
building target=portable file=release/WebForge Studio-1.0.0-portable.exe
```
