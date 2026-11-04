# Changelog

## 1.2.0 — 2026-11-04

### Added
- Discover now *connects* a tool instead of only reporting it: the connected AI model
  proposes a connect plan (`npx`, Python, static project or a manual command), and the
  main process validates every file path, package name and environment variable the plan
  claims against the files on disk before anything is registered or run.
- Website repositories can be imported as editable projects («افزودن به پروژه‌ها»),
  so an extracted or cloned site opens in the visual editor.
- Inspector rebuilt around three tabs — محتوا / استایل / ساختار — for any selected element:
  text runs, colour and box-model editing, class add/remove, `data-*` attribute save and
  delete, insert markup before/after, hide and remove element.
- High-risk plans are refused server-side unless the user explicitly forces them.
- E2E spec `tests/e2e/editor-deep.spec.ts` (6 scenarios) drives the real renderer:
  style → live preview (`toHaveCSS`), selection across reload, text replacement,
  class/attribute edits, inserted markup, deletion and undo. 14 E2E scenarios in total.

### Fixed
- Selection mode was lost after every saved edit because the preview reloads; the reloaded
  page now restores the mode and re-highlights the selected element.
- Sites with subpages opened `clean/old/index.html` instead of the homepage; the editor
  now picks the shallowest `index.html`.
- Removing an attribute left a stray space inside the tag (`<a href="/x" >`).
- A batch of applied edits produced one toast per action; now a single success toast.
- `npm`/`npx` failed on Windows: `.cmd` shims cannot be spawned without a shell, so the
  CLI is resolved to `npm-cli.js` and run through Electron in Node mode.
- Dead contract fields (`clickedText`, `hasElementChildren`) are now actually produced and
  surfaced; the unreachable `projectPath` branch in Discover was removed.

### Security
- Every message into and out of the sandboxed preview iframe is gated by a per-session
  token plus origin and `event.source` checks.
- Shell-open refuses executable/script extensions (`exe`, `msi`, `bat`, `ps1`, `js`, …),
  which a downloaded repository can contain.
- Repository copy no longer follows symbolic links, so a crafted archive cannot pull in
  files that were never inspected.

### Verified
- Built and smoke-tested on real Windows 10: `npm run package:win` produces the NSIS
  installer and the portable exe, and the packaged binary starts (`APP_READY`).
  Unit tests: 33 passing across 7 files.

## 1.1.0 — 2026-11-02

### Added
- Local folder import with a scan/report modal: type, entry file, HTML count, framework,
  hints and an explicit warning path for folders without an entry point.
- Project switcher inside the visual editor; imported folders now appear in the
  editor, QA tester and project actions (`ویرایش` / `تست`).
- Discover → **inspect & add**: downloads a repository as ZIP (size/path guarded),
  static-scans scripts/hooks/binaries/obfuscation, optionally asks DeepSeek for a
  Persian risk verdict, builds a plugin manifest, and registers the tool in the
  workspace after explicit confirmation.
- High-risk gate with an explicit responsibility checkbox; critical findings,
  missing licenses, archived repositories and non-CLI repos are explained.
- One-click `npm install --ignore-scripts` for Node plugins, with a persistent
  dependency badge and log viewer.
- Integration report is stored as `INTEGRATION.md` inside the installed tool.
- E2E coverage for local-folder import, visual preview, QA and project visibility.

### Changed
- QA and editor can switch between all imported/manual projects.
- Version bumped to 1.1.0; Windows portable/7z and release assets rebuilt.

### Security
- Plugin dependency installs ignore lifecycle scripts and force the public npm
  registry; `.npmrc`/`.yarnrc` from downloaded repositories are not copied.
- ZIP extraction blocks path traversal, zip bombs and oversized repositories.

## 1.0.0 — 2026-11-02

### Added
- Persian RTL desktop studio (Electron 45 + React 19 + TypeScript strict).
- Website extraction: SSRF guard, robots.txt, depth/size/time limits, cancellation,
  mirror/clean output, nested CSS assets, manifest and warnings, rendered-DOM mode.
- Local preview server with port fallback, keep-alive-safe stop, SSE reload, and
  injected click-to-edit runtime.
- Visual editor: text/image/link/style edits, surgical HTML patches, timestamped
  backups, Undo/Redo, edit history.
- Built-in admin panel installer compatible with the original kit, plus native
  `/api/content` and `/api/upload` endpoints.
- Plugin runtime: manifest validation, auto-generated Persian forms, Node/Python/
  executable/shell runtimes, streamed logs, timeout, cancellation, output contract.
- DeepSeek AI builder: plan approval, deterministic tokens/shell, per-page streaming
  generation, bundled Vazirmatn, support files, no external scripts/CDNs.
- Native QA suite: HTML, links, axe-core WCAG 2.2 AA, SEO, console, performance,
  responsive overflow, baseline security headers, JSON report.
- GitHub discovery with license/activity/risk evaluation.
- SQLite (`node:sqlite`) persistence, encrypted API key (`safeStorage`), redacted
  JSONL logs, diagnostics, JSON export.
- 22 unit/integration tests and 7 Electron E2E flows.
- Linux `dir` package and Windows x64 portable/7z build.

### Known limitations
- Windows package was built on Linux and not executed on real Windows in the build
  environment.
- NSIS installer requires Wine on Linux; portable archive is provided instead.
- Node/Next dev servers are not launched by the preview service.
- AI resume after partial failure is not automatic.
- Plugins are not OS-sandboxed.
- Code signing/auto-update are not configured.
