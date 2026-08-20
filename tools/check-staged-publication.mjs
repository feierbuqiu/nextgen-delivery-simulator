import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { generateThirdPartyArtifacts } from './publication-metadata.mjs'
import {
  inspectPublicEntries,
  normalizePath,
  reportFindings,
  serializePublicationManifest,
} from './publication-rules.mjs'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const release = process.argv.includes('--release')

function stagedPaths() {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: projectRoot })
  return output.toString('utf8').split('\0').filter(Boolean).map(normalizePath).sort()
}

function stagedContent(path) {
  return execFileSync('git', ['show', `:${path}`], {
    cwd: projectRoot,
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024,
  })
}

const paths = stagedPaths()
const entries = new Map(paths.map((path) => [path, stagedContent(path)]))
const findings = paths.length === 0 ? ['Git 索引为空，没有可提交的公开快照'] : []
findings.push(...inspectPublicEntries(entries, { release }))

const stagedManifest = entries.get('PUBLICATION-MANIFEST.json')?.toString('utf8') ?? ''
const expectedManifest = serializePublicationManifest(entries)
if (stagedManifest !== expectedManifest) {
  findings.push('Git 索引中的 PUBLICATION-MANIFEST.json 与拟提交文件不一致')
}

const packageText = entries.get('package.json')?.toString('utf8')
const lockText = entries.get('package-lock.json')?.toString('utf8')
const stagedSbom = entries.get('SBOM.spdx.json')?.toString('utf8') ?? ''
if (packageText && lockText) {
  try {
    const artifacts = generateThirdPartyArtifacts(lockText, packageText, stagedSbom)
    if (entries.get('THIRD_PARTY_NOTICES.md')?.toString('utf8') !== artifacts.notices) {
      findings.push('Git 索引中的 THIRD_PARTY_NOTICES.md 与锁文件不一致')
    }
    if (stagedSbom !== artifacts.sbom) findings.push('Git 索引中的 SBOM.spdx.json 与锁文件不一致')
  } catch (error) {
    findings.push(`Git 索引中的第三方元数据无法验证：${error instanceof Error ? error.message : String(error)}`)
  }
}

try {
  const unstagedManifest = readFileSync(new URL('../PUBLICATION-MANIFEST.json', import.meta.url), 'utf8')
  if (unstagedManifest !== stagedManifest) {
    findings.push('工作树与 Git 索引中的 PUBLICATION-MANIFEST.json 不一致，请确认暂存的是最新清单')
  }
} catch {
  findings.push('工作树缺少 PUBLICATION-MANIFEST.json')
}

if (!reportFindings('Git 索引公开门禁', findings)) process.exitCode = 1
