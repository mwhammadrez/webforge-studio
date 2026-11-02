import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { Logger } from '../src/main/core/logger'
import { Database } from '../src/main/core/db'

export function tempDir(prefix = 'webforge-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export function makeLogger(): Logger {
  return new Logger(tempDir('webforge-logs-'))
}

export function makeDb(dir: string): Database {
  return new Database(path.join(dir, 'test.db'))
}

export interface FixtureServer {
  url: string
  close: () => Promise<void>
  requests: string[]
}

export async function startFixtureSite(): Promise<FixtureServer> {
  const requests: string[] = []
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    requests.push(url.pathname)
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><html lang="fa" dir="rtl"><head>
        <link rel="stylesheet" href="/style.css">
        <script src="/app.js"></script>
      </head><body>
        <h1 id="title">سایت نمونه</h1>
        <img id="logo" src="/img/a.png" alt="لوگو">
        <a href="/about.html">درباره</a>
        <a href="https://external.example/x">خارجی</a>
      </body></html>`)
      return
    }
    if (url.pathname === '/about.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><html><body><h1>درباره</h1><img src="/img/a.png"></body></html>')
      return
    }
    if (url.pathname === '/style.css') {
      response.writeHead(200, { 'Content-Type': 'text/css' })
      response.end(`body { background: url('/img/bg.png'); }
@font-face { font-family: Test; src: url('/fonts/x.woff2') format('woff2'); }`)
      return
    }
    if (url.pathname === '/app.js') {
      response.writeHead(200, { 'Content-Type': 'application/javascript' })
      response.end('console.log("fixture")')
      return
    }
    if (url.pathname === '/robots.txt') {
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end('User-agent: *\nAllow: /\n')
      return
    }
    if (url.pathname.endsWith('.png')) {
      response.writeHead(200, { 'Content-Type': 'image/png' })
      response.end(png)
      return
    }
    if (url.pathname.endsWith('.woff2')) {
      response.writeHead(200, { 'Content-Type': 'font/woff2' })
      response.end(Buffer.from('wOF2fixture'))
      return
    }
    response.writeHead(404)
    response.end('not found')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
  }
}
