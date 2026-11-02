import { _electron as electron } from 'playwright-core'
const app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, WEBFORGE_QUIET: '1', WEBFORGE_USER_DATA: '/tmp/wf-int/user', WEBFORGE_PROJECTS_DIR: '/tmp/wf-int/projects' } })
const win = await app.firstWindow()
await win.waitForTimeout(1200)
const list = await win.evaluate(() => window.webforge.plugins.list())
const plugin = list.ok ? list.data.find((p) => p.name === 'np') : null
if (plugin) {
  const result = await win.evaluate((id) => window.webforge.plugins.run(id, null, { arguments: '--help' }), plugin.id)
  console.log('RUN_OK', result.ok, 'STATUS', result.ok ? result.data.run.status : result.error)
  if (result.ok) console.log('OUT', result.data.logs.slice(0, 700).replace(/\n/g, ' | '))
}
await app.close()
