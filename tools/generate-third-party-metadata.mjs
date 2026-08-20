import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateThirdPartyArtifacts } from './publication-metadata.mjs'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const noticesPath = resolve(projectRoot, 'THIRD_PARTY_NOTICES.md')
const sbomPath = resolve(projectRoot, 'SBOM.spdx.json')
const checkOnly = process.argv.includes('--check')
const existingSbom = (() => {
  try {
    return readFileSync(sbomPath, 'utf8')
  } catch {
    return ''
  }
})()
const artifacts = generateThirdPartyArtifacts(
  readFileSync(resolve(projectRoot, 'package-lock.json'), 'utf8'),
  readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
  existingSbom,
)

if (checkOnly) {
  const findings = []
  try {
    if (readFileSync(noticesPath, 'utf8') !== artifacts.notices) findings.push('THIRD_PARTY_NOTICES.md 已过期')
  } catch {
    findings.push('缺少 THIRD_PARTY_NOTICES.md')
  }
  try {
    if (readFileSync(sbomPath, 'utf8') !== artifacts.sbom) findings.push('SBOM.spdx.json 已过期')
  } catch {
    findings.push('缺少 SBOM.spdx.json')
  }
  if (findings.length > 0) {
    console.error(`第三方元数据检查失败：\n- ${findings.join('\n- ')}`)
    process.exitCode = 1
  } else {
    console.log(`第三方元数据检查通过：${artifacts.dependencyCount} 个锁定依赖。`)
  }
} else {
  writeFileSync(noticesPath, artifacts.notices)
  writeFileSync(sbomPath, artifacts.sbom)
  console.log(`第三方元数据已生成：${artifacts.dependencyCount} 个锁定依赖。`)
}
