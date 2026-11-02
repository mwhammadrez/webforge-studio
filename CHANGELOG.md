# Changelog

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
