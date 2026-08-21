import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const findings = []

function read(relativePath) {
  const absolutePath = resolve(projectRoot, relativePath)
  if (!existsSync(absolutePath)) {
    findings.push(`缺少治理文件：${relativePath}`)
    return ''
  }
  return readFileSync(absolutePath, 'utf8')
}

const workflowsDirectory = resolve(projectRoot, '.github/workflows')
const workflowNames = existsSync(workflowsDirectory)
  ? readdirSync(workflowsDirectory).filter((name) => /\.ya?ml$/u.test(name)).sort()
  : []
const expectedWorkflowNames = ['governance.yml', 'quality.yml']
if (JSON.stringify(workflowNames) !== JSON.stringify(expectedWorkflowNames)) {
  findings.push(`工作流文件必须严格为：${expectedWorkflowNames.join(', ')}`)
}

const workflows = new Map(workflowNames.map((name) => [name, read(`.github/workflows/${name}`)]))
const allowedActions = new Map([
  ['actions/checkout', 'de0fac2e4500dabe0009e67214ff5f5447ce83dd'],
  ['actions/dependency-review-action', 'a1d282b36b6f3519aa1f3fc636f609c47dddb294'],
  ['actions/github-script', 'd746ffe35508b1917358783b479e04febd2b8f71'],
  ['actions/setup-node', '820762786026740c76f36085b0efc47a31fe5020'],
])
const actionCounts = new Map()
for (const [name, content] of workflows) {
  for (const match of content.matchAll(/^\s*uses:\s*([^\s@]+)@([0-9a-f]{40})(?:\s|$)/gmu)) {
    const action = match[1]
    const sha = match[2]
    actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1)
    if (allowedActions.get(action) !== sha) findings.push(`${name} 使用了未批准或未固定的 Action：${action}@${sha}`)
  }
  const usesLines = content.match(/^\s*uses:\s*.+$/gmu) ?? []
  const parsedCount = [...content.matchAll(/^\s*uses:\s*([^\s@]+)@([0-9a-f]{40})(?:\s|$)/gmu)].length
  if (usesLines.length !== parsedCount) findings.push(`${name} 存在未固定到完整提交 SHA 的 Action`)
  if (/runs-on:\s*(?:self-hosted|\[[^\]]*self-hosted)/iu.test(content)) findings.push(`${name} 不得使用自托管运行器`)
  if (/permissions:\s*write-all|(?:contents|actions|packages|id-token):\s*write/iu.test(content)) {
    findings.push(`${name} 申请了不允许的高权限`)
  }
}

const expectedActionCounts = new Map([
  ['actions/checkout', 2],
  ['actions/dependency-review-action', 1],
  ['actions/github-script', 1],
  ['actions/setup-node', 2],
])
for (const [action, count] of expectedActionCounts) {
  if (actionCounts.get(action) !== count) findings.push(`${action} 的使用次数应为 ${count}`)
}

const quality = workflows.get('quality.yml') ?? ''
for (const expected of [
  'pull_request:',
  'push:',
  'permissions:\n  contents: read',
  'persist-credentials: false',
  'npm ci --ignore-scripts',
  'npm run check:release',
  'npm audit --audit-level=high',
  'npm.cmd run test',
  'npm.cmd run build',
  'npm.cmd run check:dev',
  'fail-on-severity: high',
]) {
  if (!quality.includes(expected)) findings.push(`quality.yml 缺少 ${JSON.stringify(expected)}`)
}
if (quality.includes('pull_request_target:')) findings.push('quality.yml 不得在高权限事件中执行贡献代码')

const governance = workflows.get('governance.yml') ?? ''
for (const expected of [
  'pull_request_target:',
  'statuses: write',
  "const statusContext = '治理规则未被绕过'",
  "labels.has('治理变更')",
  "path: 'package.json'",
  "packageJson.name !== 'nextgen-delivery-simulator'",
  "'check:dev': 'node tools/check-dev-server.mjs'",
  "'check': 'npm run check:lockfile && npm run check:runtime",
]) {
  if (!governance.includes(expected)) findings.push(`governance.yml 缺少 ${JSON.stringify(expected)}`)
}
if (/actions\/checkout@|^\s*run:/gmu.test(governance)) {
  findings.push('可信治理守卫不得签出或执行拉取请求代码')
}

const dependabot = read('.github/dependabot.yml')
for (const expected of ['package-ecosystem: npm', 'package-ecosystem: github-actions', 'interval: weekly']) {
  if (!dependabot.includes(expected)) findings.push(`dependabot.yml 缺少 ${JSON.stringify(expected)}`)
}

let packageJson = {}
try {
  packageJson = JSON.parse(read('package.json') || '{}')
} catch {
  // 其他检查器负责报告具体 JSON 错误。
}
const expectedCheck = 'npm run check:lockfile && npm run check:runtime && npm run lint && npm run check:foundation && npm run check:governance && npm run check:local-only && npm run check:architecture && npm run check:publication && npm run check:metadata && npm run check:manifest && npm run test:tools && npm run test:coverage && npm run build && npm run check:dev && npm run check:local-only && npm run check:bundle'
const requiredScripts = {
  predev: 'npm run check:runtime',
  dev: 'vite --host 127.0.0.1 --port 4173 --strictPort',
  build: 'tsc -b && vite build',
  lint: 'eslint . --max-warnings=0',
  test: 'vitest run',
  'test:coverage': 'vitest run --coverage',
  'test:tools': 'node --test tools/check-dev-server.test.mjs tools/publication-metadata.test.mjs tools/publication-rules.test.mjs',
  'check:architecture': 'node tools/check-architecture.mjs',
  'check:bundle': 'node tools/check-bundle-budgets.mjs',
  'check:dev': 'node tools/check-dev-server.mjs',
  'check:foundation': 'node tools/check-foundation.mjs',
  'check:governance': 'node tools/check-ci-governance.mjs',
  'check:lockfile': 'node tools/check-lockfile.mjs',
  'check:local-only': 'node tools/check-local-only.mjs',
  'check:publication': 'node tools/check-publication.mjs',
  'check:runtime': 'node tools/runtime-version.mjs',
  'check:metadata': 'node tools/generate-third-party-metadata.mjs --check',
  'check:manifest': 'node tools/generate-publication-manifest.mjs --check',
  check: expectedCheck,
  'check:release': 'npm run check && node tools/check-publication.mjs --release',
}
for (const [name, command] of Object.entries(requiredScripts)) {
  if (packageJson.scripts?.[name] !== command) findings.push(`package.json 不得绕过 ${name}`)
}

if (findings.length > 0) {
  console.error(`持续集成治理检查失败：\n- ${findings.join('\n- ')}`)
  process.exitCode = 1
} else {
  console.log('持续集成治理检查通过：工作流最小权限、完整 SHA、fork 隔离与治理守卫均保持完整。')
}
