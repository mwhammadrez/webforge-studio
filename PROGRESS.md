# PROGRESS

| مورد | وضعیت |
|---|---|
| نسخه | 1.0.0 |
| تاریخ | 2026-11-02 |
| Typecheck | ✅ صفر خطا |
| Unit/Integration | ✅ 22/22 در 6 فایل |
| E2E Electron | ✅ 7/7 |
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
- تست: ۲۲ تست واحد/یکپارچه. رفع باگ‌های واقعی:
  - keep-alive سوکت‌های preview بعد از Stop → `closeAllConnections`.
  - دارایی‌های داخل CSS دانلود نمی‌شدند → کشف بازگشتی `url()`/`@import`.
  - undo محتوای کامل فایل را ذخیره نمی‌کرد → snapshot کامل.
  - ناسازگاری preload/IPC (آرگومان خام vs آبجکت) → همهٔ کانال‌ها یکدست.
  - `security` در enum تستر نبود.
- E2E واقعی ۷ سناریو سبز (شامل اجرای پلاگین Node خارجی با لاگ/خروجی).
- اصلاحات کیفی نهایی: log redaction ایمن، لغو پلاگین حین اجرا، حفظ حالت انتخاب بعد از reload، فونت وزیرمتن در سایت AI، flatten کردن slugهای تودرتو.
- بیلد Linux و Windows portable؛ اجرای بستهٔ Linux موفق.
- تلاش برای Gofile ۳/۴: `error-notPremium`، سپس `429`، سپس TLS reset از IP دیتاسنتر. محتوا دریافت نشد.

## شواهد کلیدی

```text
$ npm run verify
typecheck: OK
tests: 22 passed (6 files)
placeholder gate: passed
build: OK
```

```text
$ xvfb-run -a npx playwright test
7 passed (7.4s)
```

```text
$ npx electron-builder --win portable
building target=portable file=release/WebForge Studio-1.0.0-portable.exe
```
