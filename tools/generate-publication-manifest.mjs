import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadWorkingTree,
  reportFindings,
  serializePublicationManifest,
} from './publication-rules.mjs'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const manifestPath = resolve(projectRoot, 'PUBLICATION-MANIFEST.json')
const checkOnly = process.argv.includes('--check')
const { entries, findings } = loadWorkingTree(projectRoot)

if (!reportFindings('文件清单输入检查', findings)) process.exit(1)

const expected = serializePublicationManifest(entries)
if (checkOnly) {
  let actual = ''
  try {
    actual = readFileSync(manifestPath, 'utf8')
  } catch {
    // 下面的统一差异提示覆盖缺失文件。
  }
  if (actual !== expected) {
    console.error('公开文件清单已过期；请运行 npm run generate:manifest，并在内容稳定后重新暂存。')
    process.exitCode = 1
  } else {
    console.log(`公开文件清单检查通过：${entries.size - 1} 个文件。`)
  }
} else {
  writeFileSync(manifestPath, expected)
  console.log(`公开文件清单已生成：${entries.size} 个文件。`)
}
