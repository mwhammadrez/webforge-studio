import fs from 'node:fs'
import path from 'node:path'

export type NpmCli = 'npm' | 'npx'

/**
 * Node refuses to spawn the `npm.cmd`/`npx.cmd` shims directly (EINVAL since the
 * CVE-2024-27980 hardening), and running them through a shell would put user
 * arguments into a command string. Resolving the CLI script lets us launch npm
 * through plain argv instead.
 */
export function findNpmLauncher(cli: NpmCli): string | null {
  const roots: string[] = []
  const execDir = path.dirname(process.execPath)
  roots.push(path.join(execDir, 'node_modules', 'npm'))
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    roots.push(path.join(dir, 'node_modules', 'npm'))
    roots.push(path.join(dir, '..', 'lib', 'node_modules', 'npm'))
  }
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'npm'))
  if (process.env.ProgramFiles) roots.push(path.join(process.env.ProgramFiles, 'nodejs', 'node_modules', 'npm'))
  roots.push('/usr/lib/node_modules/npm', '/usr/local/lib/node_modules/npm')

  for (const root of roots) {
    const script = path.join(root, 'bin', `${cli}-cli.js`)
    try {
      if (fs.existsSync(script)) return script
    } catch {
      // unreadable candidate — keep looking
    }
  }
  return null
}
