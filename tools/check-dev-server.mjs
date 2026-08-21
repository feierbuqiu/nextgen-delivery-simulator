import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertSupportedNodeRuntime } from './runtime-version.mjs'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))

function reserveLoopbackPort() {
  return new Promise((resolvePort, reject) => {
    const reservation = createServer()
    reservation.unref()
    reservation.once('error', reject)
    reservation.listen(0, '127.0.0.1', () => {
      const address = reservation.address()
      if (!address || typeof address === 'string') {
        reservation.close()
        reject(new Error('无法分配本机开发服务器测试端口。'))
        return
      }
      reservation.close((error) => {
        if (error) reject(error)
        else resolvePort(address.port)
      })
    })
  })
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

export function findReactRefreshPreamble(html) {
  const normalizedHtml = html.toLowerCase()
  const marker = 'injectIntoGlobalHook(window)'
  let markerIndex = html.indexOf(marker)

  while (markerIndex >= 0) {
    let openingStart = normalizedHtml.lastIndexOf('<script', markerIndex)
    while (openingStart >= 0 && !/[\s/>]/u.test(normalizedHtml[openingStart + 7] ?? '')) {
      openingStart = normalizedHtml.lastIndexOf('<script', openingStart - 1)
    }

    if (openingStart >= 0) {
      const openingEnd = html.indexOf('>', openingStart + 7)
      let closingStart = normalizedHtml.indexOf('</script', openingEnd + 1)
      while (closingStart >= 0 && !/[\s>]/u.test(normalizedHtml[closingStart + 8] ?? '')) {
        closingStart = normalizedHtml.indexOf('</script', closingStart + 8)
      }

      if (openingEnd >= 0 && openingEnd < markerIndex && closingStart > markerIndex) {
        const closingEnd = html.indexOf('>', closingStart + 8)
        const attributes = html.slice(openingStart + 7, openingEnd)
        if (closingEnd >= 0 && /\btype\s*=\s*["']module["']/iu.test(attributes)) {
          return html.slice(openingEnd + 1, closingStart)
        }
      }
    }

    markerIndex = html.indexOf(marker, markerIndex + marker.length)
  }
  return null
}

function directiveSources(policy, directiveName) {
  const directive = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === directiveName || part.startsWith(`${directiveName} `))
  return directive ? new Set(directive.split(/\s+/u).slice(1)) : new Set()
}

async function waitForResponse(url, server, diagnostics) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`开发服务器提前退出（${server.exitCode}）。\n${diagnostics.join('')}`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return response
    } catch {
      // Vite 尚未开始监听；在截止时间前继续轮询。
    }
    await delay(100)
  }
  throw new Error(`开发服务器未在 15 秒内响应：${url}\n${diagnostics.join('')}`)
}

async function stopServer(server) {
  if (server.exitCode !== null) return
  server.kill()
  await Promise.race([
    new Promise((resolveExit) => server.once('exit', resolveExit)),
    delay(3_000).then(() => {
      if (server.exitCode === null) server.kill('SIGKILL')
    }),
  ])
}

export async function checkDevServer() {
  assertSupportedNodeRuntime()
  const port = await reserveLoopbackPort()
  const diagnostics = []
  const server = spawn(process.execPath, [
    resolve(projectRoot, 'node_modules/vite/bin/vite.js'),
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ], {
    cwd: projectRoot,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  server.stdout.on('data', (chunk) => diagnostics.push(chunk.toString()))
  server.stderr.on('data', (chunk) => diagnostics.push(chunk.toString()))

  try {
    const origin = `http://127.0.0.1:${port}`
    const rootResponse = await waitForResponse(`${origin}/`, server, diagnostics)
    const html = await rootResponse.text()
    const reactRefreshPreamble = findReactRefreshPreamble(html)
    if (!reactRefreshPreamble ||
        !html.includes('/@vite/client') ||
        !html.includes('/src/main.tsx')) {
      throw new Error('开发入口缺少 React 刷新前导、Vite 客户端或应用入口。')
    }
    const contentSecurityPolicy = String(rootResponse.headers.get('content-security-policy'))
    if (!contentSecurityPolicy.includes("default-src 'self'")) {
      throw new Error('开发服务器未返回本机运行所需的内容安全策略。')
    }
    const scriptSources = directiveSources(contentSecurityPolicy, 'script-src')
    const requiredPreambleHash = `'sha256-${createHash('sha256').update(reactRefreshPreamble).digest('base64')}'`
    if (!scriptSources.has(requiredPreambleHash)) {
      throw new Error(`开发 CSP 不允许执行 React 刷新前导脚本，缺少 ${requiredPreambleHash}。`)
    }
    if (scriptSources.has("'unsafe-inline'")) {
      throw new Error("开发 CSP 不应以 'unsafe-inline' 放开所有内联脚本。")
    }
    const entryResponse = await waitForResponse(`${origin}/src/main.tsx`, server, diagnostics)
    const entry = await entryResponse.text()
    if (!entry.includes('react-dom_client') || !entry.includes('createRoot')) {
      throw new Error('React 应用入口未被开发服务器正确转换。')
    }
    console.log(`开发服务器烟测通过：Node.js ${process.versions.node}，回环入口、React 转换与前导脚本 CSP 均正常。`)
  } finally {
    await stopServer(server)
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await checkDevServer()
}
