# وابستگی‌ها و مجوزها

تاریخ: ۲۰۲۶-11-02 · `npm audit --omit=dev --audit-level=high` → **0 vulnerabilities**

## Runtime

| بسته | نسخه | مجوز | کاربرد |
|---|---|---|---|
| electron | 45.2.1 | MIT | پوستهٔ دسکتاپ/Chromium |
| react / react-dom | 19.3.1 | MIT | رابط |
| zustand | 5.0.16 | MIT | state |
| zod | 4.6.7 | MIT | اعتبارسنجی IPC/فرم/مانیفست |
| cheerio | 1.2.0 | MIT | پارس/ویرایش HTML + source offsets |
| postcss | 8.5.32 | MIT | بازنویسی CSS |
| chokidar | 4.0.3 | MIT | watch فایل برای رفرش پیش‌نمایش |
| mime-types | 3.0.2 | MIT | Content-Type سرور پیش‌نمایش |
| axe-core | 4.14.0 | MPL-2.0 | قواعد دسترس‌پذیری در QA |

> axe-core تحت MPL-2.0 است. استفادهٔ بدون تغییر و توزیع فایل مجاز است؛ اگر خود axe را تغییر دهی، تغییرات آن فایل باید منتشر شود. کد برنامهٔ ما جدا و خصوصی است.

## Development

| بسته | نسخه | مجوز |
|---|---|---|
| electron-vite | 6.0.0 | MIT |
| vite | 8.3.5 | MIT |
| @vitejs/plugin-react | 6.2.1 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| vitest | 5.0.5 | MIT |
| @playwright/test / playwright-core | 1.64.1 | Apache-2.0 |
| electron-builder | 26.18.0 | MIT |

## دارایی‌ها

| مورد | منبع | مجوز |
|---|---|---|
| Vazirmatn woff2 | npm `vazirmatn@33.0.3` | SIL Open Font License 1.1 |
| آیکون برنامه | ساختهٔ همین پروژه | متعلق به پروژه |
| کیت پنل ادمین | ابزار ورودی کاربر (RAR) | مجوز مستقل خودش؛ در بستهٔ خصوصی استفاده می‌شود |

## ابزارهای ردشده به‌دلیل مجوز/ریسک

HTTrack (GPL)، wget (GPL + CVE)، single-file-cli (AGPL)، Webstudio (AGPL)، ZAP/Nuclei (فعال/تهاجمی و نیازمند مجوز محیط).
