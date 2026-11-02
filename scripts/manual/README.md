# Manual smoke tests

These scripts launch the real Electron app and use the real GitHub network. They are
not part of CI.

- `test-integration.mjs` — inspect + install `sindresorhus/np`.
- `test-integration-deps.mjs` — run `npm install --ignore-scripts` for the installed np plugin.
- `test-integration-run.mjs` — run `np --help` through the plugin runtime.

They share `/tmp/wf-int/user` as WEBFORGE_USER_DATA, so run them in order:

```bash
xvfb-run -a node scripts/manual/test-integration.mjs
xvfb-run -a node scripts/manual/test-integration-deps.mjs
xvfb-run -a node scripts/manual/test-integration-run.mjs
```

Requires `playwright-core`, `xvfb` on Linux, and GitHub network access.
