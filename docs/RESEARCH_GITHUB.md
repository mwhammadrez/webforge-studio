# پژوهش GitHub و انتخاب ابزارها

تاریخ پژوهش: ۲۰۲۶-۱۱-۰۲ · روش: GitHub API + npm registry + مستندات رسمی + بازبینی کد/README

هدف: برای چهار مسیر «استخراج، ویرایش بصری، ساخت با AI، تست و امنیت» بهترین گزینه‌های متن‌باز را پیدا و بر اساس **مجوز، نگهداری، سازگاری با Electron و ریسک** فیلتر کنیم. این سند تصمیم‌ها را ثبت می‌کند، نه ادعای benchmark.

---

## ۱. استخراج و آینه‌سازی

| ابزار | مجوز | ستاره | SPA | بازنویسی دارایی | ریسک اصلی | حکم |
|---|---|---:|---|---|---|---|
| `website-scraper` | MIT | ~1.8k | ❌ | ✅ کامل (HTML/CSS/srcset) | پیش‌فرض `rejectUnauthorized:false`، concurrency بی‌نهایت، abort ندارد | الگو گرفته شد؛ وابسته نشدیم |
| `website-scraper-puppeteer` | MIT | ~376 | ✅ | ارثی | Chrome جدا | نیاز نبود؛ Chromium Electron |
| `goclone` | MIT | ~2.3k | ❌ | جزئی | TLS غیرفعال، بدون timeout/عمق | رد |
| HTTrack | GPL-3.0 | ~4.8k | ❌ | ✅ | GPL + CLI بدون JSON progress | رد |
| wget | GPL-3.0 | — | ❌ | نسبی | CVE-2026-58470 بدون fix | رد |
| single-file-cli | AGPL-3.0 | ~1.7k | ✅ | inline | AGPL برای بستهٔ تجاری | رد |
| monolith | CC0 | ~15.6k | ❌ | inline | نیاز به HTML رندرشده | آیندهٔ «تک‌فایل» |
| Playwright/Puppeteer | Apache-2.0 | 99k/95k | ✅ | ❌ | فقط کپچر | استفاده از CDP Electron |
| crawlee | Apache-2.0 | ~26k | ✅ | ❌ | درخت وابستگی سنگین | برای مقیاس بزرگ آینده |
| cheerio | MIT | ~30k | — | DOM edit | DoS روی HTML خصمانه | ✅ استفاده شد |
| postcss | MIT | ~29k | — | CSS url/@import | CVE قدیمی fix شده | ✅ استفاده شد |
| parse5 | MIT | ~3.9k | — | offsets دقیق | DoS | ✅ غیرمستقیم via cheerio |

**تصمیم:** پیاده‌سازی بومی روی `fetch` + cheerio + postcss. Chromium خود Electron برای حالت رندرشده. هیچ وابستگی GPL/AGPL. `mirror` و `clean` جدا. SSRF روی هر redirect.

---

## ۲. ویرایش بصری و CMS

| ابزار | مجوز | ستاره | ویرایش HTML موجود | حکم |
|---|---|---:|---|---|
| GrapesJS | BSD-3 | ~26k | ۳/۵ (بازنویسی component) | برای ساخت صفحه، نه patch منبع |
| Craft.js | MIT | ~8.8k | ۱/۵ | React-only، بدون آپدیت از ۲۰۲۵ |
| Builder.io SDK | MIT (SDK) | ~8.9k | ۲/۵ | ادیتور SaaS |
| TinaCMS | Apache-2.0 | ~14k | ۱/۵ (field mapping) | React-bound |
| Decap CMS | MIT | ~19.5k | ۲/۵ | فرم‌محور |
| Netlify Visual Editor | Proprietary | — | ۱/۵ | بسته به تیم‌های قبلی |
| Webstudio | AGPL-3.0 | ~9.1k | ۱/۵ | اپ AGPL، import ندارد |
| Onlook | Apache-2.0 | ~27k | ۲/۵ (React) | الگوی `data-oid` + AST |
| Puck | MIT | ~13.6k | ۱/۵ | JSON block |
| Tiptap | MIT | ~39k | ۵/۵ متن | فقط متن غنی |

**نتیجهٔ پژوهش:** هیچ کتابخانهٔ متن‌بازی ویرایش source-faithful روی HTML دلخواه انجام نمی‌دهد. مسیر درست: offsetهای parse5 + patch جراحی + backup/Undo. Onlook بهترین مرجع معماری است.

**پیاده‌سازی:** cheerio با `sourceCodeLocationInfo`؛ patch متن/attr/style/image/link با splice؛ پشتیبان در `.webforge/backups`؛ snapshot کامل برای Undo/Redo؛ fallback بر اساس متن قبلی.

---

## ۳. ساخت سایت با AI

### DeepSeek (مستندات رسمی، ۲۰۲۶-۱۱-۰۲)
- مدل‌ها: `deepseek-flash` (vision، ۱M context، 384K output) و `deepseek-v4-pro`.
- `deepseek-chat`/`deepseek-reasoner` بازنشسته شده‌اند.
- endpoint: `POST https://api.deepseek.com/chat/completions` (OpenAI-compatible).
- `thinking` پیش‌فرض روشن است؛ ما `{"type":"disabled"}` می‌فرستیم تا temperature اثر کند.
- JSON mode فقط `json_object` است، نه `json_schema`.
- SSE: `delta.content`، فریم‌های keep-alive با `:`، usage روی آخرین chunk.
- محدودیت: concurrency، نه RPM/TPM؛ 429.
- قیمت Flash: ورودی cache-miss ~$0.30/M، خروجی ~$1.2/M (peak)؛ off-peak نصف.

### اسکیل‌های طراحی
| مخزن | مجوز | ستاره | چه می‌دهد |
|---|---|---:|---|
| anthropics/skills → frontend-design | Apache-2.0 | ~187k | فرایند طراحی، ضد AI slop، self-critique |
| nextlevelbuilder/ui-ux-pro-max-skill | MIT | ~144k | BM25 روی ۷۹ سبک/۱۹۲ پالت/۷۴ فونت |
| plugin87/ux-ui-agent-skills | MIT | ~3.1k | توکن DTCG، ۵۲ کامپوننت، gate |
| superdesign-skill | MIT | ~934 | نیاز به CLI اختصاصی |
| shadcn/ui | MIT | ~127k | registry واقعی کامپوننت |

**پیاده‌سازی:** اسکیل بومی `resources/skills/web-design/SKILL.md` با قواعد ده‌گانه + لیست ضد الگو + جریان Spec-first. پلن JSON → تأیید → tokens.css قطعی → پوستهٔ مشترک → صفحه‌به‌صفحه. این کار هزینه و ناسازگاری چندصفحه‌ای را کم می‌کند.

### سایت‌سازهای AI
| ابزار | مجوز | ستاره | درس |
|---|---|---:|---|
| Onlook | Apache-2.0 | ~27k | context محدود به عنصر، ابزارهای ویرایش |
| bolt.diy | MIT | ~20k | artifact protocol، اما پرامپت طراحی قدیمی |
| dyad | Apache-2.0 | ~22k | plan mode و مثال‌ها |
| open-lovable | MIT | ~29k | scrape→spec→generate |
| screenshot-to-code | MIT | ~81k | حلقهٔ screenshot verification |
| Webstudio | AGPL-3.0 | ~9.1k | مدل CSS کامل، اما AGPL |

**تصمیم:** الگوی spec-first + deterministic shell؛ نه پرامپت «Apple-level gradient» و نه بازتولید کل صفحه برای ویرایش.

---

## ۴. تست، کیفیت و امنیت

| ابزار | مجوز | ستاره | نقش | حکم |
|---|---|---:|---|---|
| Playwright | Apache-2.0 | ~99k | E2E/کراول | ✅ برای تست خود برنامه |
| axe-core | MPL-2.0 | ~7.7k | WCAG | ✅ داخل QA |
| pa11y | LGPL-3.0 | ~4.6k | WCAG دوم | پلاگین آینده |
| Lighthouse | Apache-2.0 | ~31k | perf/SEO | پلاگین آینده (سنگین) |
| Unlighthouse | MIT | ~4.9k | کراول کل سایت | آینده |
| vnu | MIT | ~2k | HTML conformance | پلاگین آینده |
| lychee | MIT/Apache | ~4.1k | لینک‌چک سریع | پلاگین آینده |
| BackstopJS | MIT | ~7.2k | visual regression | آینده |
| pixelmatch | ISC | ~7k | diff تصویر | آینده |
| OWASP ZAP | Apache-2.0 | ~16k | DAST | فقط staging با مجوز |
| Nuclei | MIT | ~32.5k | template scan | فقط staging |
| Semgrep | LGPL-2.1 | ~17k | SAST | CI آینده |
| Trivy | Apache-2.0 | ~39k | SCA/secrets | CI آینده |
| OSV-Scanner | Apache-2.0 | ~11k | SCA | CI آینده |

**پیاده‌سازی فعلی:** Chromium Electron + axe-core + بررسی لینک/کنسول/SEO/پرفورمنس/ریسپانسیو/امنیت پایه. ZAP/Nuclei عمداً بسته نشدند چون ابزار فعال/تهاجمی‌اند و اجرای نادرست آن‌ها ریسک قانونی دارد.

---

## ۵. ابزارهای «خیلی کاربردی» که پیشنهاد می‌شود بعداً اضافه شوند

1. **lychee** — لینک‌چک سریع و کم‌هزینه برای هر پروژه.
2. **vnu** — اعتبارسنجی HTML مطابق WHATWG؛ سبک و آفلاین.
3. **Lighthouse/Unlighthouse** — بودجهٔ LCP/CLS/TBT؛ نه score.
4. **pixelmatch + Playwright** — visual regression سبک بدون Backstop.
5. **OSV-Scanner + Trivy** — زنجیرهٔ تأمین پروژه‌های Node.
6. **monolith** — خروجی تک‌فایل برای تحویل به مشتری.
7. **shadcn registry / ui-ux-pro-max** — ورودی دانش طراحی برای AI.
8. **Semgrep** — بازبینی امنیتی کد پروژه‌های مشتری.

معیار افزودن: مجوز permissive، باینری قابل‌امضا، اجرای جدا از renderer، گزارش JSON، و امکان اجرای آفلاین.

---

## ۶. منابع اصلی

- GitHub REST: `https://api.github.com/repos/<owner>/<repo>`
- npm: `https://registry.npmjs.org/<package>`
- DeepSeek: `api-docs.deepseek.com` (chat, json_mode, thinking, rate_limit, pricing)
- Electron security: `electronjs.org/docs/latest/tutorial/security`
- parse5: `parse5.js.org` · PostCSS: `postcss.org/api`
- Onlook wiki/parser · GrapesJS discussions #6732 · Tina/Decap docs
- axe-core/Playwright · lychee docs · vnu manual · ZAP baseline · Nuclei docs

> ستاره‌ها و تاریخ‌ها در لحظهٔ پژوهش ثبت شده‌اند و تغییر می‌کنند. قبل از قفل کردن نسخه، دوباره بررسی کن.
