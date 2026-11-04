# راهنمای آپدیت و انتشار

## پیش‌نیاز
- Node 22.12+ (توسعهٔ اپ روی Node 24 تست شده) و npm 11+
- `npm ci`
- اگر `npm ci` باینری Electron را دانلود نکرد (سیاست `allow-scripts`)، دستی: `node node_modules/electron/install.js`
- روی لینوکس برای ساخت بستهٔ ویندوز: `wine` (فقط NSIS؛ portable به Wine نیاز ندارد). روی ویندوز مستقیم ساخته می‌شود.

## چرخهٔ آپدیت
1. تغییرات را در branch جدا اعمال کن.
2. `npm run verify` را سبز کن.
3. E2E واقعی را اجرا کن: `npm run test:e2e` (روی لینوکس با `xvfb-run -a`).
4. نسخه را در `package.json` و `CHANGELOG.md` به‌روزرسانی کن.
5. commit با Conventional Commits.
6. بسته‌سازی:
   ```bash
   npm run build
   npm run package:win        # ویندوز: nsis + portable
   npx electron-builder --linux dir   # لینوکس: AppImage/dir
   ```
7. آرشیو کامل (برنامه + سورس + مستندات) را بساز و به‌عنوان asset در GitHub Release بگذار.
8. تگ `vX.Y.Z` را push کن.

## CI
`.github/workflows/verify.yml` روی هر push/PR به `main` اجرا می‌شود:
`npm ci` → `npm run verify`.

E2E به‌دلیل نیاز به Xvfb/Electron در CI پیش‌فرض اجرا نمی‌شود؛ به‌صورت محلی با
`npm run test:e2e` (ویندوز) یا `xvfb-run -a npx playwright test` (لینوکس) اجرا کن.

## بسته‌بندی ویندوز
- `release/win-unpacked/` → پوشهٔ اجرایی
- `release/WebForge Studio-<version>-x64.exe` → نصب‌کنندهٔ NSIS
- `release/WebForge Studio-<version>-portable.exe` → تک‌فایل portable
- روی ویندوز هر دو هدف بدون Wine ساخته می‌شوند؛ بدون گواهی امضا، SmartScreen هشدار می‌دهد.

## امنیت انتشار
- هرگز `.env`، توکن GitHub، یا خروجی استخراج سایت‌های خصوصی را commit نکن.
- Release assetها را از توکن‌های کوتاه‌عمر بساز و بعد revoke کن.
