import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const trustedRegistry = 'https://registry.npmjs.org/'
const findings = []

const lockfile = JSON.parse(readFileSync(resolve(projectRoot, 'package-lock.json'), 'utf8'))

if (lockfile.lockfileVersion !== 3) {
  findings.push(`package-lock.json 的 lockfileVersion 必须为 3，当前为 ${lockfile.lockfileVersion}`)
}

const packages = Object.entries(lockfile.packages ?? {})
if (packages.length <= 1) {
  findings.push('package-lock.json 未记录任何依赖包')
}

for (const [packagePath, entry] of packages) {
  if (packagePath === '') continue
  if (entry.link === true) {
    findings.push(`${packagePath} 是链接依赖，不允许绕过 registry 安装`)
    continue
  }
  if (entry.inBundle === true) continue
  if (typeof entry.resolved !== 'string' || entry.resolved.length === 0) {
    findings.push(`${packagePath} 缺少 resolved 下载来源`)
  } else if (!entry.resolved.startsWith(trustedRegistry)) {
    findings.push(`${packagePath} 的下载来源不在官方 npm registry：${entry.resolved}`)
  }
  if (typeof entry.integrity !== 'string' || !/^sha(?:256|384|512)-/u.test(entry.integrity)) {
    findings.push(`${packagePath} 缺少可校验的 integrity 完整性哈希`)
  }
}

if (findings.length > 0) {
  console.error(`锁文件供应链检查失败：\n- ${findings.join('\n- ')}`)
  process.exitCode = 1
} else {
  console.log(`锁文件供应链检查通过：${packages.length - 1} 个依赖包全部来自官方 npm registry 并携带完整性哈希。`)
}
