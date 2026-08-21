import { createHash } from 'node:crypto'
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { relative, resolve, sep } from 'node:path'

const ignoredDirectoryNames = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
])

const mandatoryPaths = [
  '.github/dependabot.yml',
  '.github/ISSUE_TEMPLATE/bug.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/feature.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/workflows/governance.yml',
  '.github/workflows/quality.yml',
  'ARCHITECTURE.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'DATA_POLICY.md',
  'GOVERNANCE.md',
  'KNOWN_DEBT.md',
  'LICENSE',
  'PROJECT_CHARTER.md',
  'PUBLICATION-MANIFEST.json',
  'PUBLICATION_POLICY.md',
  'README.md',
  'REPOSITORY_SETUP.md',
  'SBOM.spdx.json',
  'SECURITY.md',
  'THIRD_PARTY_NOTICES.md',
  'index.html',
  'package-lock.json',
  'package.json',
  'public/robots.txt',
  'src/app/localOnly.ts',
  'src/main.tsx',
  'tools/check-publication.mjs',
  'tools/check-dev-server.mjs',
  'tools/check-ci-governance.mjs',
  'tools/check-foundation.mjs',
  'tools/check-staged-publication.mjs',
  'tools/generate-publication-manifest.mjs',
  'tools/generate-third-party-metadata.mjs',
  'tools/publication-metadata.mjs',
  'tools/publication-rules.mjs',
  'tools/runtime-version.mjs',
  'tools/atomic-write.mjs',
]

const forbiddenPathRules = [
  { label: '私有导出工具', pattern: /(^|\/)publication(\/|$)/iu },
  { label: '私有来源材料', pattern: /(^|\/)(?:private-reference|local-reference)(\/|$)/iu },
  { label: '内部规格或验收材料', pattern: /(^|\/)docs\/(?:specifications|verification)(\/|$)/iu },
  { label: '端到端视觉基线', pattern: /(^|\/)tests\/e2e(\/|$)|playwright\.config\.[cm]?[jt]s$/iu },
  { label: '环境文件', pattern: /(^|\/)\.env(?:\.|$)/iu },
  { label: '源码映射', pattern: /\.map$/iu },
  { label: '归档或办公附件', pattern: /\.(?:7z|docx?|gz|pdf|pptx?|rar|tar|xlsx?|zip)$/iu },
  { label: '未审核的位图或字体', pattern: /\.(?:bmp|gif|ico|jpe?g|otf|png|ttf|webp|woff2?)$/iu },
  { label: '外部托管配置', pattern: /(^|\/)(?:netlify\.toml|vercel\.json|wrangler\.(?:jsonc?|toml)|\.openai\/hosting\.json)$/iu },
]

const forbiddenTextRules = [
  { label: '现实机构名称', pattern: /中国邮政|中邮|邮储|大国邮政|新一代营业渠道系统/iu },
  { label: '现实机构英文名称', pattern: /\bchina\s+post\b/iu },
  { label: '现实速递标识', pattern: /\bEMS\b/u },
  { label: '复刻或逐项还原表述', pattern: /一比一|one[- ]to[- ]one/iu },
  { label: '来源页面表述', pattern: /参考页面|参考字段|专有截图|参考截图|原系统/iu },
  { label: '非公开材料表述', pattern: /内部资料|内部手册|内部指南|内部截图/iu },
  { label: '外部开发托管域名', pattern: /(?:pages|workers)\.dev/iu },
  { label: '旧交易前缀', pattern: /GNP-/iu },
  { label: '本机绝对路径', pattern: /[A-Z]:[\\/]Users[\\/]|\/Users\/[^/]+\/|\/home\/[^/]+\//u },
  { label: '私钥正文', pattern: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u },
  { label: 'GitHub 访问令牌', pattern: /\b(?:gh[oprsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u },
  { label: '云访问密钥', pattern: /\bAKIA[0-9A-Z]{16}\b/u },
  { label: '现实手机号形态', pattern: /(?<![0-9A-Za-z])1[3-9]\d{9}(?![0-9A-Za-z])/u },
  { label: '现实居民身份号码形态', pattern: /(?<![0-9A-Za-z])[1-8]\d{16}[0-9Xx](?![0-9A-Za-z])/u },
  { label: '隐藏码点重建逻辑', pattern: /String\.fromCodePoint\s*\(/u },
]

const policyDefinitionPaths = new Set(['tools/publication-rules.mjs'])

export function normalizePath(value) {
  return value.split(sep).join('/').replace(/^\.\//u, '')
}

export function isIgnoredPath(relativePath) {
  return normalizePath(relativePath).split('/').some((part) => ignoredDirectoryNames.has(part))
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

export function createPublicationManifest(entries) {
  const files = [...entries.entries()]
    .filter(([path]) => path !== 'PUBLICATION-MANIFEST.json' && !isIgnoredPath(path))
    .map(([path, content]) => ({
      path,
      bytes: Buffer.byteLength(content),
      sha256: sha256(content),
    }))
    .sort((left, right) => left.path.localeCompare(right.path, 'en'))
  return {
    schemaVersion: 1,
    algorithm: 'SHA-256',
    generatedBy: 'tools/generate-publication-manifest.mjs',
    files,
  }
}

export function serializePublicationManifest(entries) {
  return `${JSON.stringify(createPublicationManifest(entries), null, 2)}\n`
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

function readStableDirectory(directory, relativePath, findings) {
  const before = lstatSync(directory)
  if (before.isSymbolicLink() || !before.isDirectory()) {
    findings.push(`${relativePath || '.'}：扫描期间目录类型发生变化`)
    return []
  }
  const children = readdirSync(directory, { withFileTypes: true })
  const after = lstatSync(directory)
  if (after.isSymbolicLink() || !after.isDirectory() || !sameFileIdentity(before, after)) {
    findings.push(`${relativePath || '.'}：扫描期间目录类型或身份发生变化`)
    return []
  }
  return children
}

function readStableFile(absolutePath, relativePath, entries, findings) {
  let descriptor
  try {
    descriptor = openSync(absolutePath, 'r')
  } catch {
    findings.push(`${relativePath}：扫描期间文件无法稳定打开`)
    return
  }

  try {
    const openedBefore = fstatSync(descriptor)
    const currentPathMetadata = lstatSync(absolutePath)
    const pathChanged =
      currentPathMetadata.isSymbolicLink() ||
      !currentPathMetadata.isFile() ||
      !sameFileIdentity(openedBefore, currentPathMetadata)
    if (!openedBefore.isFile() || pathChanged) {
      findings.push(`${relativePath}：扫描期间文件类型或身份发生变化`)
      return
    }

    const content = readFileSync(descriptor)
    const openedAfter = fstatSync(descriptor)
    const contentChanged =
      !sameFileIdentity(openedBefore, openedAfter) ||
      openedBefore.size !== openedAfter.size ||
      openedBefore.mtimeMs !== openedAfter.mtimeMs ||
      openedBefore.ctimeMs !== openedAfter.ctimeMs
    if (contentChanged) {
      findings.push(`${relativePath}：扫描期间文件内容发生变化`)
      return
    }
    entries.set(relativePath, content)
  } catch {
    findings.push(`${relativePath}：扫描期间文件无法稳定读取`)
  } finally {
    closeSync(descriptor)
  }
}

function walkWorkingTree(projectRoot, directory, entries, findings) {
  const directoryPath = normalizePath(relative(projectRoot, directory))
  for (const child of readStableDirectory(directory, directoryPath, findings)) {
    const absolutePath = resolve(directory, child.name)
    const relativePath = normalizePath(relative(projectRoot, absolutePath))
    if (isIgnoredPath(relativePath)) continue

    if (child.isSymbolicLink()) {
      findings.push(`${relativePath}：公开仓库不接受符号链接`)
      continue
    }
    if (child.isDirectory()) {
      walkWorkingTree(projectRoot, absolutePath, entries, findings)
    } else if (child.isFile()) {
      readStableFile(absolutePath, relativePath, entries, findings)
    } else {
      findings.push(`${relativePath}：公开仓库不接受特殊文件`)
    }
  }
}

export function loadWorkingTree(projectRoot) {
  const entries = new Map()
  const findings = []
  walkWorkingTree(projectRoot, projectRoot, entries, findings)
  return { entries, findings }
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length
}

function scanPlainText(relativePath, text, findings, context = '') {
  for (const rule of forbiddenTextRules) {
    const index = text.search(rule.pattern)
    if (index >= 0) {
      findings.push(`${relativePath}:${lineNumber(text, index)}：发现${rule.label}${context}`)
    }
  }
}

function decodedRepresentations(text) {
  const values = []

  for (const match of text.matchAll(/\[((?:\s*\d{2,7}\s*,){1,127}\s*\d{2,7}\s*,?)\]/gu)) {
    const codePoints = [...match[1].matchAll(/\d{2,7}/gu)].map((entry) => Number(entry[0]))
    if (codePoints.length >= 2 && codePoints.every((value) => value <= 0x10_FFFF)) {
      try {
        values.push({ label: '（由数字码点解码）', value: String.fromCodePoint(...codePoints) })
      } catch {
        // 非法码点序列不参与解码检查，原文本仍会接受常规检查。
      }
    }
  }

  const unicodeDecoded = text.replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})/giu, (_match, braced, fixed) => {
    try {
      return String.fromCodePoint(Number.parseInt(braced ?? fixed, 16))
    } catch {
      return ''
    }
  })
  if (unicodeDecoded !== text) values.push({ label: '（由 Unicode 转义解码）', value: unicodeDecoded })

  const entityDecoded = text.replace(/&#(?:x([0-9a-f]{2,6})|(\d{2,7}));/giu, (_match, hex, decimal) => {
    try {
      return String.fromCodePoint(Number.parseInt(hex ?? decimal, hex ? 16 : 10))
    } catch {
      return ''
    }
  })
  if (entityDecoded !== text) values.push({ label: '（由字符实体解码）', value: entityDecoded })

  for (const match of text.matchAll(/(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{16,512}={0,2}(?![A-Za-z0-9+/=])/gu)) {
    try {
      const decoded = Buffer.from(match[0], 'base64').toString('utf8')
      const printable = [...decoded].filter((character) => character >= ' ' || character === '\n' || character === '\t').length
      if (decoded && printable / decoded.length > 0.9) values.push({ label: '（由 Base64 解码）', value: decoded })
    } catch {
      // 非 Base64 令牌忽略。
    }
  }

  return values
}

function inspectPackageMetadata(entries, findings) {
  const packageContent = entries.get('package.json')
  const lockContent = entries.get('package-lock.json')
  if (!packageContent || !lockContent) return

  try {
    const packageJson = JSON.parse(packageContent.toString('utf8'))
    const lockfile = JSON.parse(lockContent.toString('utf8'))
    if (packageJson.private !== true) findings.push('package.json：必须保持 private=true，防止误发 npm 包')
    if (packageJson.name !== 'nextgen-delivery-simulator') findings.push('package.json：项目包名必须为 nextgen-delivery-simulator')
    if (packageJson.license !== 'MIT') findings.push('package.json：许可证必须为 MIT')
    if (packageJson.name !== lockfile.name || packageJson.version !== lockfile.version) {
      findings.push('package.json 与 package-lock.json 的名称或版本不一致')
    }
    if (lockfile.packages?.['']?.name !== packageJson.name || lockfile.packages?.['']?.version !== packageJson.version) {
      findings.push('package-lock.json 根包元数据与 package.json 不一致')
    }
    if (lockfile.packages?.['']?.license !== packageJson.license) {
      findings.push('package-lock.json 根包许可证与 package.json 不一致')
    }
    for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
      if (/deploy|publish|release:remote|upload/iu.test(name) || /wrangler|netlify|vercel|pages deploy/iu.test(String(command))) {
        findings.push(`package.json：禁止公开发布或远端部署脚本 ${name}`)
      }
    }
    for (const name of ['dev', 'preview']) {
      if (!String(packageJson.scripts?.[name] ?? '').includes('--host 127.0.0.1')) {
        findings.push(`package.json：${name} 必须显式绑定 127.0.0.1`)
      }
    }
  } catch (error) {
    findings.push(`包元数据无法解析：${error instanceof Error ? error.message : String(error)}`)
  }
}

export function inspectPublicEntries(entries, { release = false } = {}) {
  const findings = []

  for (const mandatoryPath of mandatoryPaths) {
    if (!entries.has(mandatoryPath)) findings.push(`缺少公开基座文件：${mandatoryPath}`)
  }

  for (const [relativePath, content] of entries) {
    for (const rule of forbiddenPathRules) {
      if (rule.pattern.test(relativePath)) findings.push(`${relativePath}：发现${rule.label}`)
    }
    if (content.length > 2 * 1024 * 1024) findings.push(`${relativePath}：单文件超过 2 MiB 公开上限`)
    if (content.includes(0)) {
      findings.push(`${relativePath}：包含二进制 NUL 字节`)
      continue
    }
    if (policyDefinitionPaths.has(relativePath)) continue

    const text = content.toString('utf8')
    scanPlainText(relativePath, text, findings)
    for (const decoded of decodedRepresentations(text)) {
      scanPlainText(relativePath, decoded.value, findings, decoded.label)
    }
  }

  inspectPackageMetadata(entries, findings)

  if (release) {
    const licenseText = entries.get('LICENSE')?.toString('utf8') ?? ''
    if (!licenseText.includes('MIT License') || !licenseText.includes('Permission is hereby granted')) {
      findings.push('发布门禁：LICENSE 不是完整的 MIT 许可证正文')
    }
    const packageContent = entries.get('package.json')
    if (packageContent) {
      try {
        const license = JSON.parse(packageContent.toString('utf8')).license
        if (license !== 'MIT') findings.push('发布门禁：package.json 的 SPDX 许可证标识必须为 MIT')
      } catch {
        // 常规包元数据检查已经报告解析失败。
      }
    }
  }

  return findings
}

export function reportFindings(label, findings) {
  if (findings.length > 0) {
    console.error(`${label}失败：\n- ${[...new Set(findings)].join('\n- ')}`)
    return false
  }
  console.log(`${label}通过。`)
  return true
}
