# راهنمای آپدیت و انتشار

## پیش‌نیاز
- Node 24+
- `npm ci`
- برای بستهٔ ویندوز روی لینوکس: `electron-builder` (NSIS installer به Wine نیاز دارد؛ portable نیاز ندارد)

## چرخهٔ آپدیت
1. تغییرات را در branch جدا اعمال کن.
2. `npm run verify` را سبز کن.
3. `xvfb-run -a npx playwright test` را روی لینوکس اجرا کن.
4. نسخه را در `package.json` و `CHANGELOG.md` به‌روزرسانی کن.
5. commit با Conventional Commits.
6. بسته‌سازی:
   ```bash
   npm run build
   npx electron-builder --linux dir --win portable
   ```
7. آرشیو کامل (برنامه + سورس + مستندات) را بساز و به‌عنوان asset در GitHub Release بگذار.
8. تگ `vX.Y.Z` را push کن.

## CI
`.github/workflows/verify.yml` روی هر push/PR به `main` اجرا می‌شود:
`npm ci` → `npm run verify`.

E2E به‌دلیل نیاز به Xvfb/Electron در CI پیش‌فرض اجرا نمی‌شود؛ به‌صورت محلی با
`xvfb-run -a npx playwright test` اجرا کن.

## بسته‌بندی ویندوز
- `release/win-unpacked/` → پوشهٔ اجرایی
- `release/WebForge Studio-1.0.0-portable.exe` → تک‌فایل portable
- نصب‌کنندهٔ NSIS فقط روی ویندوز یا لینوکس با Wine ساخته می‌شود.

## امنیت انتشار
- هرگز `.env`، توکن GitHub، یا خروجی استخراج سایت‌های خصوصی را commit نکن.
- Release assetها را از توکن‌های کوتاه‌عمر بساز و بعد revoke کن.
