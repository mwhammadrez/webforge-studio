import { _electron as electron } from 'playwright-core'
const app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, WEBFORGE_QUIET: '1', WEBFORGE_USER_DATA: '/tmp/wf-int/user', WEBFORGE_PROJECTS_DIR: '/tmp/wf-int/projects' } })
const win = await app.firstWindow()
await win.waitForTimeout(1200)
const inspect = await win.evaluate(() => window.webforge.integration.inspect('sindresorhus/np'))
console.log('INSPECT_OK', inspect.ok)
if (inspect.ok) {
  const r = inspect.data
  console.log(JSON.stringify({ fullName: r.fullName, license: r.license, risk: r.riskLevel, runtime: r.runtime, installable: r.installable, packageName: r.packageName, bin: r.bin, files: r.fileCount, findings: r.findings.length, ai: r.ai, manifest: r.proposedManifest && { name: r.proposedManifest.name, permissions: r.proposedManifest.permissions } }, null, 2))
  if (r.installable) {
    const installed = await win.evaluate(() => window.webforge.integration.install('sindresorhus/np', false))
    console.log('INSTALL_OK', installed.ok)
    if (installed.ok) console.log('PLUGIN', JSON.stringify({ id: installed.data.plugin.id, name: installed.data.plugin.name, displayName: installed.data.plugin.displayName, runtime: installed.data.plugin.runtime, hasDependencies: installed.data.plugin.hasDependencies }))
    else console.log('INSTALL_ERR', JSON.stringify(installed.error))
  }
} else console.log('INSPECT_ERR', JSON.stringify(inspect.error))
await app.close()
