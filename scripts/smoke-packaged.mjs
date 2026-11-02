import { _electron as electron } from 'playwright-core'
const app = await electron.launch({ executablePath: 'release/linux-unpacked/webforge-studio', args: ['--no-sandbox'], env: { ...process.env, WEBFORGE_QUIET: '1', WEBFORGE_USER_DATA: '/tmp/wf-packaged-data', WEBFORGE_PROJECTS_DIR: '/tmp/wf-packaged-projects' } })
const win = await app.firstWindow({ timeout: 30000 })
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1200)
console.log('TITLE', await win.title())
console.log('TEXT', (await win.locator('body').innerText()).slice(0, 200).replace(/\n/g, ' | '))
await win.screenshot({ path: '/tmp/packaged.png' })
await app.close()
