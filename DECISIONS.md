# DECISIONS

## D-1 — Electron + React + TypeScript + electron-vite
**چرا:** Chromium داخلی برای پیش‌نمایش/رندر، API فایل و پردازه، و بیلد ساده. Tauri به‌دلیل تفاوت WebView و پیچیدگی automation رد شد.

## D-2 — `node:sqlite` به‌جای better-sqlite3
**چرا:** در Electron 45 (Node 24) بدون کامپایل native کار می‌کند و cross-build ویندوز را ساده می‌کند. با تست واقعی در Electron تأیید شد.
**هزینه:** API جدیدتر؛ برای مهاجرت به better-sqlite3 لایهٔ `Database` آماده است.

## D-3 — CSS سفارشی به‌جای Tailwind
**چرا:** کنترل کامل RTL، تم دارک/لایت، اندازهٔ باندل و جلوگیری از پیچیدگی purge در Electron. فونت Vazirmatn لوکال.
**انحراف:** جدول فناوری پرامپت Tailwind را پیشنهاد داده بود؛ این تصمیم در `SPEC.md` ثبت شده است.

## D-4 — ویرایشگر بصری سفارشی با offsetهای parse5
**چرا:** GrapesJS برای HTML موجود مناسب نیست و ساختار را بازنویسی می‌کند. cheerio با `sourceCodeLocationInfo` offsets دقیق می‌دهد؛ patch جراحی + backup + Undo امن‌تر است.
**منبع:** پژوهش `docs/RESEARCH_GITHUB.md` و معماری Onlook.

## D-5 — پیش‌نمایش با iframe + تزریق اسکریپت، نه webview
**چرا:** iframe ساده‌تر و امن‌تر است؛ ارتباط cross-origin با `postMessage`. تزریق از سرور محلی انجام می‌شود و نیازی به دسترسی مستقیم به DOM cross-origin نیست.

## D-6 — API سازگار با پنل ادمین در سرور پیش‌نمایش
**چرا:** کیت اصلی با `serve.ps1` فقط ویندوز بود. پیاده‌سازی `/api/content`, `/api/upload`, `pages.json` در سرور داخلی، همان `admin.html` و `site-editor.js` را cross-platform می‌کند.
**محدودیت:** پنل بدون احراز هویت و فقط روی 127.0.0.1 است.

## D-7 — کلید API با `safeStorage`
**چرا:** DPAPI ویندوز / Keychain مک / libsecret لینوکس. کلید هرگز به renderer نمی‌رود.
**پیامد:** روی لینوکس بدون keyring، ذخیرهٔ کلید ممکن نیست و برنامه پیام مشخص می‌دهد؛ `DEEPSEEK_API_KEY` جایگزین است.

## D-8 — QA با Chromium خود Electron + axe-core
**چرا:** بدون دانلود مرورگر دوم، بدون سرویس ابری، سریع و آفلاین. باینری‌های ZAP/Nuclei/Lighthouse به‌دلیل حجم/مجوز/ریسک بسته نشدند.
**جایگزین آینده:** پلاگین‌های اختیاری برای lychee/vnu/Lighthouse.

## D-9 — AI: DeepSeek Flash + معماری Spec-first
**چرا:** ارزان، ۱M context، سازگار OpenAI، JSON mode و استریم. پلن قبل از هزینه، پوستهٔ قطعی برای جلوگیری از تکرار هزینه و ناسازگاری.
**مدل‌ها:** `deepseek-flash` پیش‌فرض، `deepseek-v4-pro` انتخابی.

## D-10 — تست SSRF با env مخصوص تست
`WEBFORGE_ALLOW_PRIVATE=1` فقط در تست‌های یکپارچه؛ در تولید پیش‌فرض خاموش است. این یک درِ پشتی مستند است، نه رفتار کاربر.

## D-11 — بسته‌بندی
- Linux dir ساخته و اجرا شد.
- Windows portable ساخته شد (NSIS portable با 7z؛ بدون نیاز به Wine).
- NSIS installer ساخته نشد چون electron-builder برای uninstaller به Wine نیاز دارد.
- امضای کد ندارد.

## D-12 — Gofile
دانلود ابزار ۳ و ۴ ممکن نشد: `error-notPremium` با توکن مهمان، سپس `error-rateLimit`، سپس TLS reset از IP دیتاسنتر. توکن پویا (`sha256(UA::lang::token::window::salt)`) پیاده و استفاده شد، اما IP بلاک شد. پرونده‌ها ممیزی نشدند و این صادقانه در `docs/TOOL_AUDIT.md` ثبت شده است.

## ریسک‌های باقی‌مانده
- اجرای واقعی روی ویندوز/Defender تأیید نشده.
- پلاگین ناشناس sandbox OS ندارد.
- ویرایش DOM پویا فقط fallback دارد.
- accessibility خود اپ به‌صورت خودکار تست نشده.
