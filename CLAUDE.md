# WebForge Studio — Agent Notes

## Commands
- Install: `npm install`
- Develop: `npm run dev`
- Full gate: `npm run verify`
- Unit/integration: `npm test`
- E2E (Linux headless): `xvfb-run -a npx playwright test`
- Build: `npm run build`
- Windows: `npx electron-builder --win portable`
- Placeholder gate: `npm run check:placeholders`

## Hard rules
- UI is Persian RTL, dark-gray-first with a light theme.
- Electron 45 + React 19 + TypeScript strict + `node:sqlite`.
- Never commit `.env`, secrets, extracted sites, build output, or user projects.
- Validate every IPC input with Zod in `src/main/ipc.ts`.
- Renderer has no Node/FS/child-process/secret access.
- Every preview stop must destroy keep-alive sockets.
- Every edit writes a timestamped backup; Undo stores full before/after.
- Extraction must re-check SSRF on every redirect and refuse private ranges.
- Never use TODO/FIXME, skipped tests, empty catches, placeholder code.
- Never weaken or delete tests to make them pass.
- Never claim success without real command output.

## Layout
- `src/main/services/` — extraction, preview, editor, plugins, ai, qa, discovery.
- `src/main/services/editor-client.ts` — injected preview runtime (postMessage).
- `src/shared/` — types, Zod schemas, IPC contract.
- `tests/` — unit/integration; `tests/e2e/` — real Electron.
- `resources/kits/admin-panel` — user's admin kit; `resources/skills` — editable design/extraction/QA skills.
