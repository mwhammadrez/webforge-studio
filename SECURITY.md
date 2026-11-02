# Security

## Reporting

This is a private project. Report issues directly to the repository owner. Do not
open public issues containing secrets, extracted private sites, or credentials.

## Secret policy

- Never commit `.env`, API keys, GitHub tokens, cookies, or authorization headers.
- The DeepSeek key is stored with Electron `safeStorage` (DPAPI/Keychain/libsecret)
  and is never sent to the renderer, logs, or IPC payloads.
- `DEEPSEEK_API_KEY` and `GITHUB_TOKEN` are environment-only alternatives.
- Logs run through redaction for keys, bearer tokens, cookies, and passwords.
- If a token is exposed, revoke it immediately at
  https://github.com/settings/tokens and create a short-lived replacement.

## Network boundaries

- Extraction accepts only public `http`/`https` URLs. Loopback, private,
  link-local, multicast, and local IPv6 ranges are blocked on every redirect.
- Downloaded files are never executed.
- The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and
  `sandbox: true`; all IPC inputs are validated with Zod.
- Plugin network blocking is best-effort. Do not run untrusted plugins outside a
  disposable VM.

## Repository hygiene

- Build output, `node_modules`, extracted sites, and release artifacts are ignored.
- CI runs `npm run verify`, which includes the placeholder gate. No skipped tests,
  weakened assertions, `@ts-ignore`, or `eslint-disable` are allowed.
