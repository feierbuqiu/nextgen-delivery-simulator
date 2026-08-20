import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const findings = []

function read(relativePath) {
  const absolutePath = resolve(projectRoot, relativePath)
  if (!existsSync(absolutePath)) {
    findings.push(`缺少基础文件：${relativePath}`)
    return ''
  }
  return readFileSync(absolutePath, 'utf8')
}

function requireText(relativePath, expected) {
  if (!read(relativePath).includes(expected)) {
    findings.push(`${relativePath} 缺少不可变基础声明 ${JSON.stringify(expected)}`)
  }
}

const charter = read('PROJECT_CHARTER.md')
const charterHash = createHash('sha256').update(charter).digest('hex')
const expectedCharterHash = '37a17a4ee38f94adfb40f025e747cf65491a015d650f0e5014311ace4f3e72b1'
if (charterHash !== expectedCharterHash) {
  findings.push('PROJECT_CHARTER.md 与受保护的项目宪章基线不一致')
}

let packageJson = {}
try {
  packageJson = JSON.parse(read('package.json') || '{}')
} catch (error) {
  findings.push(`package.json 无法解析：${error instanceof Error ? error.message : String(error)}`)
}

if (packageJson.name !== 'nextgen-delivery-simulator') findings.push('项目包名必须保持 nextgen-delivery-simulator')
if (packageJson.private !== true) findings.push('package.json 必须保持 private=true')
if (packageJson.license !== 'MIT') findings.push('项目许可证必须保持 MIT')
if (packageJson.description !== '使用虚构数据、仅限本机运行的中文次世代寄递业务模拟器。') {
  findings.push('package.json 的中文项目定位发生变化')
}
const expectedKeywords = ['次世代', '寄递', '模拟器', '本机运行', '虚构数据']
if (JSON.stringify(packageJson.keywords) !== JSON.stringify(expectedKeywords)) {
  findings.push('package.json 的项目关键词发生变化')
}

const requiredScripts = {
  'check:foundation': 'node tools/check-foundation.mjs',
  'check:governance': 'node tools/check-ci-governance.mjs',
  'check:local-only': 'node tools/check-local-only.mjs',
  'check:publication': 'node tools/check-publication.mjs',
  'check:release': 'npm run check && node tools/check-publication.mjs --release',
}
for (const [name, command] of Object.entries(requiredScripts)) {
  if (packageJson.scripts?.[name] !== command) findings.push(`package.json 不得绕过 ${name}`)
}
for (const name of ['check:foundation', 'check:governance', 'check:local-only', 'check:publication']) {
  if (!String(packageJson.scripts?.check ?? '').includes(`npm run ${name}`)) {
    findings.push(`package.json 的 check 必须包含 ${name}`)
  }
}

requireText('README.md', '# 次世代寄递业务模拟器')
requireText('README.md', '[项目宪章](PROJECT_CHARTER.md)')
requireText('index.html', '<html lang="zh-CN">')
requireText('index.html', '<title>次世代寄递业务模拟器</title>')
requireText('PROJECT_CHARTER.md', '默认且唯一受支持的运行方式是本机浏览器访问回环地址')
requireText('PROJECT_CHARTER.md', '用户界面、使用说明、治理文档、议题模板和拉取请求模板以简体中文为默认语言')
requireText('PROJECT_CHARTER.md', '任何放宽“永久定位”或接受“禁止的漂移”的修改均不属于可接受的治理变更')
requireText('CONTRIBUTING.md', '每个提交必须带有可由 GitHub 验证的 GPG、SSH 或 S/MIME 密码学签名')
requireText('GOVERNANCE.md', '合并方式依次选择 merge commit、squash、rebase')
requireText('GOVERNANCE.md', '普通拉取请求所需 reviewer 数量固定为 0')
requireText('REPOSITORY_SETUP.md', '所有分支签名规则集')
requireText('.githooks/pre-push', "grep -q '^gpgsig '")

if (findings.length > 0) {
  console.error(`项目基础边界检查失败：\n- ${findings.join('\n- ')}`)
  process.exitCode = 1
} else {
  console.log('项目基础边界检查通过：名称、中文定位、MIT 许可、项目宪章和强制门禁均保持完整。')
}
