import { _electron as electron } from 'playwright-core'
const app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, WEBFORGE_QUIET: '1', WEBFORGE_USER_DATA: '/tmp/wf-int/user', WEBFORGE_PROJECTS_DIR: '/tmp/wf-int/projects' } })
const win = await app.firstWindow()
await win.waitForTimeout(1200)
const list = await win.evaluate(() => window.webforge.plugins.list())
const plugin = list.ok ? list.data.find((p) => p.name === 'np') : null
console.log('PLUGIN_FOUND', Boolean(plugin))
if (plugin) {
  const result = await win.evaluate((id) => window.webforge.plugins.installDependencies(id), plugin.id)
  console.log('DEPS_OK', result.ok, 'EXIT', result.ok ? result.data.exitCode : result.error)
  if (result.ok) console.log('LOGS_TAIL', result.data.logs.slice(-500))
}
await app.close()
