#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const ROOTS = ['src', 'tests']
const EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.css', '.html'])
const BANNED = [
  { pattern: /\bTODO\b/g, label: 'TODO' },
  { pattern: /\bFIXME\b/g, label: 'FIXME' },
  { pattern: /\bHACK\b/g, label: 'HACK' },
  { pattern: /implement later/gi, label: 'implement later' },
  { pattern: /rest of the code/gi, label: 'rest of the code' },
  { pattern: /same as above/gi, label: 'same as above' },
  { pattern: /lorem ipsum/gi, label: 'lorem ipsum' },
  { pattern: /throw new Error\(['"]not implemented/gi, label: 'not implemented throw' },
  { pattern: /\.skip\s*\(\s*\)/g, label: 'skipped test (.skip)' },
  // `test.skip(!process.env.X, 'reason')` is an opt-in test, not a stub; `test.skip('name', …)` is.
  { pattern: /^\s*(?:test|it|describe|suite)\.skip\s*\(\s*['"`]/g, label: 'unconditionally skipped test' },
  { pattern: /\.only\s*\(/g, label: 'focused test (.only)' },
  { pattern: /\bxit\s*\(/g, label: 'xit test' },
  { pattern: /\bxfail\b/g, label: 'xfail' },
  { pattern: /pytest\.mark\.skip/g, label: 'pytest skip' },
  { pattern: /@Ignore\b/g, label: '@Ignore' },
  { pattern: /eslint-disable/g, label: 'eslint-disable' },
  { pattern: /@ts-ignore/g, label: '@ts-ignore' },
  { pattern: /@ts-expect-error/g, label: '@ts-expect-error' },
  { pattern: /# type: ignore/g, label: '# type: ignore' },
  { pattern: /\bnoqa\b/g, label: 'noqa' }
]

const findings = []

function walk(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'out', 'dist', 'test-results'].includes(entry.name)) continue
      walk(full)
      continue
    }
    if (!EXTS.has(path.extname(entry.name))) continue
    // The gate scans production and test sources, not test result artifacts.
    if (full.includes(`${path.sep}test-results${path.sep}`)) continue
    const content = fs.readFileSync(full, 'utf8')
    const lines = content.split('\n')
    lines.forEach((line, index) => {
      for (const rule of BANNED) {
        rule.pattern.lastIndex = 0
        if (rule.pattern.test(line)) {
          findings.push({ file: full, line: index + 1, label: rule.label, text: line.trim().slice(0, 160) })
        }
      }
    })
  }
}

for (const root of ROOTS) walk(path.resolve(root))

if (findings.length > 0) {
  console.error(`Placeholder gate failed: ${findings.length} finding(s).`)
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} [${finding.label}] ${finding.text}`)
  }
  process.exit(1)
}
console.log('Placeholder gate passed: no banned patterns in src/ or tests/.')
