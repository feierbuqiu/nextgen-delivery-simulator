import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const findings = []

function read(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

function requireText(relativePath, expected) {
  if (!read(relativePath).includes(expected)) {
    findings.push(`${relativePath} 缺少 ${JSON.stringify(expected)}`)
  }
}

const packageJson = JSON.parse(read('package.json'))
if (packageJson.private !== true) findings.push('package.json 必须保持 private=true')
for (const script of ['dev', 'preview']) {
  if (!packageJson.scripts?.[script]?.includes('--host 127.0.0.1')) {
    findings.push(`package.json 的 ${script} 必须只监听 127.0.0.1`)
  }
}

for (const expected of [
  "host: '127.0.0.1'",
  'sourcemap: false',
  "'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet'",
]) {
  requireText('vite.config.ts', expected)
}
for (const expected of ['isLocalRuntime(window.location)', 'renderLocalOnlyBlock(root)']) {
  requireText('src/main.tsx', expected)
}
for (const expected of ['127.0.0.1', 'localhost', '[::1]']) {
  requireText('src/app/localOnly.ts', expected)
}
requireText('index.html', 'noindex, nofollow, noarchive, nosnippet')
requireText('public/robots.txt', 'Disallow: /')

const externalHostingFiles = [
  '.openai/hosting.json',
  'public/_headers',
  'public/404.html',
  'netlify.toml',
  'vercel.json',
  'wrangler.json',
  'wrangler.jsonc',
  'wrangler.toml',
]
for (const relativePath of externalHostingFiles) {
  if (existsSync(resolve(projectRoot, relativePath))) {
    findings.push(`不得保留外部托管配置 ${relativePath}`)
  }
}

if (existsSync(resolve(projectRoot, '.git'))) {
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).split('\0').filter(Boolean).map((path) => path.replaceAll('\\', '/'))
  for (const relativePath of externalHostingFiles) {
    if (tracked.includes(relativePath)) findings.push(`Git 索引中不得包含外部托管配置 ${relativePath}`)
  }
}

const runtimeNetworkRules = [
  { label: 'fetch 网络请求', pattern: /(?<![\w.])fetch\s*\(/u },
  { label: 'XMLHttpRequest 网络请求', pattern: /\bXMLHttpRequest\b/u },
  { label: 'WebSocket 网络连接', pattern: /\bnew\s+WebSocket\s*\(/u },
  { label: 'EventSource 网络连接', pattern: /\bnew\s+EventSource\s*\(/u },
  { label: 'sendBeacon 遥测请求', pattern: /\bsendBeacon\s*\(/u },
]

function scanRuntimeDirectory(directory) {
  for (const child of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, child.name)
    if (child.isDirectory()) {
      if (child.name !== 'test') scanRuntimeDirectory(absolutePath)
      continue
    }
    if (!child.isFile() || !/\.[cm]?[jt]sx?$/u.test(child.name) || /\.test\.[cm]?[jt]sx?$/u.test(child.name)) continue
    const content = readFileSync(absolutePath, 'utf8')
    const displayPath = relative(projectRoot, absolutePath).replaceAll('\\', '/')
    for (const rule of runtimeNetworkRules) {
      if (rule.pattern.test(content)) findings.push(`${displayPath} 包含${rule.label}`)
    }
  }
}

scanRuntimeDirectory(resolve(projectRoot, 'src'))

const distDirectory = resolve(projectRoot, 'dist')
if (existsSync(distDirectory)) {
  const distIndex = resolve(distDirectory, 'index.html')
  if (!existsSync(distIndex) || !readFileSync(distIndex, 'utf8').includes('noindex, nofollow, noarchive, nosnippet')) {
    findings.push('dist/index.html 缺少禁止收录声明')
  }
  const sourceMaps = readdirSync(distDirectory, { recursive: true })
    .filter((entry) => String(entry).endsWith('.map'))
  if (sourceMaps.length > 0) findings.push(`dist/ 不得包含源码映射：${sourceMaps.join(', ')}`)
}

if (findings.length > 0) {
  console.error(`本机运行边界检查失败：\n- ${findings.join('\n- ')}`)
  process.exitCode = 1
} else {
  console.log('本机运行边界检查通过：仅允许回环地址，未发现外部托管配置。')
}
