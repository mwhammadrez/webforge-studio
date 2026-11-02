# VERIFICATION REPORT

تاریخ: ۲۰۲۶-۱۱-۰۲ · همهٔ دستورها در همین session اجرا شده‌اند.

## ۱. کیفیت استاتیک و تست

```text
$ npm run typecheck
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json
(exit 0، بدون خروجی)

$ npm test
Test Files  7 passed (7)
Tests       25 passed (25)
```

| فایل | پوشش |
|---|---|
| `tests/url-guard.test.ts` | private/public IP، پروتکل، credentials، localhost |
| `tests/extraction.test.ts` | خزش واقعی، CSS تودرتو، بازنویسی، مانیفست، رد private |
| `tests/editor.test.ts` | متن/استایل/عکس/لینک، backup، Undo/Redo، path traversal |
| `tests/preview.test.ts` | سرو HTML + تزریق، ۴۰۴، API پنل، آپلود، توقف |
| `tests/manifest.test.ts` | اعتبارسنجی مانیفست و defaultها |
| `tests/ai.test.ts` | پلن، تولید کامل با SSE جعلی، 401، بدون کلید |
| `tests/integration-analysis.test.ts` | تشخیص bin/runtime و ساخت مانیفست ادغام |

```text
$ npm run check:placeholders
Placeholder gate passed: no banned patterns in src/ or tests/.

$ npm audit --omit=dev --audit-level=high
found 0 vulnerabilities

$ npm run build
out/main/index.js   177.99 kB
out/preload/index.cjs 5.67 kB
out/renderer/index.html 0.84 kB
out/renderer/assets/index-*.js 796.63 kB
(exit 0)
```

## ۲. E2E واقعی Electron

```text
$ xvfb-run -a npx playwright test
Running 8 tests using 1 worker

✓ dashboard and navigation render in Persian RTL
✓ extracts a real site through the UI
✓ preview loads and supports click-to-edit with persistence
✓ admin panel plugin installs into the site
✓ external Node plugin runs with logs and output contract
✓ QA tester runs and produces a report
✓ theme toggle persists
✓ imports a local folder and exposes it to the visual editor and QA

8 passed (11.6s)
```

این تست‌ها واقعاً:
- یک سایت fixture محلی را از طریق UI استخراج کردند،
- فایل‌های `clean/index.html`، `style.css` و `img/bg.png` را روی دیسک بررسی کردند،
- preview را بالا آوردند و h1 را با کلیک انتخاب و متن را ذخیره کردند،
- وجود پشتیبان را تأیید کردند،
- پنل ادمین را نصب و `admin.html`/`pages.json` را بررسی کردند،
- یک پلاگین Node خارجی را ثبت و اجرا کردند و لاگ/خروجی/کد خروج را بررسی کردند،
- تست جامع را اجرا و `reports/qa-report.json` را خواندند،
- تم را عوض کردند.

## ۳. بسته‌بندی

```text
$ npx electron-builder --linux dir --win portable
packaging platform=win32 arch=x64 appOutDir=release/win-unpacked
building target=portable file=release/WebForge Studio-1.0.0-portable.exe
(exit 0)
```

| خروجی | اندازه | تأیید |
|---|---:|---|
| `release/linux-unpacked/webforge-studio` | 224MB | ✅ با Xvfb اجرا و داشبورد دیده شد |
| `release/win-unpacked/WebForge Studio.exe` | — | ساختار PE32+ x64 بررسی شد |
| `release/WebForge Studio-1.0.0-portable.exe` | 107MB | NSIS portable، شامل `app-64.7z` |
| `release/WebForge-Studio-1.0.0-win-x64.zip` | 157MB | آرشیو win-unpacked |

اجرای بستهٔ Linux:

```text
$ xvfb-run -a node scripts-smoke-packaged.mjs
TITLE WebForge Studio
TEXT W | WebForge Studio | استودیوی سایت | ... فضای کاری تو ...
```

## ۳.۵ ادغام واقعی یک ابزار GitHub

```text
$ xvfb-run -a node scripts/manual/test-integration.mjs
INSPECT_OK true
fullName: sindresorhus/np | license: MIT | risk: medium | runtime: node
installable: true | packageName: np | bin: ./source/cli.js | files: 215
INSTALL_OK true
PLUGIN {"name":"np","runtime":"node","hasDependencies":false}

$ xvfb-run -a node scripts/manual/test-integration-deps.mjs
DEPS_OK true EXIT 0
added 563 packages in 20s

$ xvfb-run -a node scripts/manual/test-integration-run.mjs
RUN_OK true STATUS success
stdout: A better `npm publish` / Usage / $ np <version> …
```

این مسیر کامل «کشف → بازرسی → افزودن → نصب وابستگی → اجرا» را با یک ریپوی واقعی تأیید می‌کند.

## ۴. موارد تأیید نشده (NOT VERIFIED)

- اجرای فایل portable روی ویندوز واقعی — ویندوز در محیط نبود.
- نصب‌کنندهٔ NSIS — `spawn wine ENOENT`.
- اتصال واقعی DeepSeek با کلید پولی — تست با سرور جعلی انجام شد؛ درخواست پولی ارسال نشد.
- حالت rendered استخراج روی سایت واقعی JS-heavy — کد پیاده شده اما E2E ندارد.
- دسترس‌پذیری خود اپ با axe — روی UI اجرا نشد.
- بسته‌های Gofile ۳ و ۴ — بلاک شبکه.

## ۵. بازتولید

```bash
npm install
npm run verify
xvfb-run -a npx playwright test     # روی Linux headless
npm run package:win                 # روی ویندوز یا Linux با Wine برای NSIS
```
