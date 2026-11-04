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

- اجرای فایل portable روی ویندوز واقعی — ویندوز در محیط نبود. *(به بخش ۶ مراجعه کن: در ۱۳ آبان روی ویندوز واقعی انجام شد.)*
- نصب‌کنندهٔ NSIS — `spawn wine ENOENT`. *(در ۱۳ آبان روی ویندوز واقعی ساخته شد.)*
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

## ۶. ویندوز واقعی — ۱۳ آبان ۲۰۲۶ (۱.۲.۰)

همهٔ دستورها روی ویندوز ۱۰ (x64)، Node v24.18.0، npm 11.x و Playwright 1.64.1 اجرا شدند.
مخزن در `C:\Users\MidONe\Desktop\webforge-studio` کلون شد و `npm ci` اجرا شد؛ سیاست
`allow-scripts` دانلود باینری Electron را متوقف کرد و با `node node_modules/electron/install.js`
جبران شد (Electron 45.2.1، حدود ۳۵۷M در `node_modules/electron/dist`).

```text
$ npm run verify
typecheck: OK
tests: 36 passed (7 files)
placeholder gate: passed
build: OK

$ npm run test:e2e
14 passed (15.7s) · 2 skipped
  8 tests/e2e/app.spec.ts        (RTL، استخراج، پیش‌نمایش+کلیک-و-ویرایش، پنل ادمین،
                                  پلاگین Node خارجی، تستر، تم، ورود پوشهٔ محلی)
  6 tests/e2e/editor-deep.spec.ts (استایل→پیش‌نمایش زنده با toHaveCSS،
                                  حفظ حالت انتخاب بعد از reload، جایگزینی متن،
                                  افزودن کلاس + ذخیره/حذف ویژگی بدون فاصلهٔ اضافه،
                                  درج HTML + مخفی + حذف عنصر، Undo)

$ WEBFORGE_LIVE_NET=1 npx playwright test discover-live
2 passed (7.1s)
  جستجوی واقعی در GitHub → باز کردن مخزن → بازرسی → طرح اتصال خودکار
  تبدیل مخزن به پروژهٔ قابل‌ویرایش در `from-github/` (فایل‌ها روی دیسک چک شدند)

$ npm run package:win
building target=nsis     file=release/WebForge Studio-1.2.0-x64.exe        (124,565,691 B ≈ 119M)
building target=portable file=release/WebForge Studio-1.2.0-portable.exe   (112,717,974 B ≈ 108M)
release/win-unpacked                                                       (≈ 383M)

$ "./release/win-unpacked/WebForge Studio.exe"
[info] APP_READY WebForge Studio آماده شد.
```

نکات:
- دو باگ فقط با اجرای واقعی GUI دیده شد و رفع گردید: حالت انتخاب بعد از reload از دست می‌رفت،
  و پروژهٔ چندصفحه‌ای `clean/old/index.html` را به‌جای صفحهٔ اصلی باز می‌کرد. هر دو حالا E2E دارند.
- `electron-builder` گزارش `no code signing certificate configured` می‌دهد؛ فایل‌ها امضا ندارند
  و SmartScreen هشدار می‌دهد.
- خودِ نصب‌کنندهٔ NSIS نصب/اجرا نشده؛ باینری `win-unpacked` بالا آمده و E2E روی Electron واقعی اجرا شده است.
- اجرای زندهٔ Discover روی GitHub دو مشکل واقعی را بیرون آورد و رفع شد:
  1. هر مخزن Node با `package.json` ولی بدون `bin` در مخزن، پلن `npx <name>` می‌گرفت — یعنی اگر
     آن name هنوز منتشر نشده باشد، npx هر چیزی را که کسی زیر آن نام منتشر کرده نصب می‌کرد.
     حالا فقط وقتی `npx` پیشنهاد می‌شود که نام دقیق در خط نصب README آمده باشد (`npm i` / `yarn add` / `pnpm add` / `npx`).
  2. وارد کردن یک سایت به‌عنوان پروژهٔ قابل‌ویرایش، فقط به‌خاطر نداشتن فایل LICENSE، تیک
     «مسئولیت ریسک را می‌پذیرم» می‌خواست؛ اگرچه هیچ کدی اجرا نمی‌شود. گیت ریسک حالا فقط برای
     استراتژی‌هایی است که کد اجرا می‌کنند و یافته‌ها همچنان در مودال نمایش داده می‌شوند.

