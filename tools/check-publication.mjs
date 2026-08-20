import { fileURLToPath } from 'node:url'
import {
  inspectPublicEntries,
  loadWorkingTree,
  reportFindings,
} from './publication-rules.mjs'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const release = process.argv.includes('--release')
const loaded = loadWorkingTree(projectRoot)
const findings = [
  ...loaded.findings,
  ...inspectPublicEntries(loaded.entries, { release }),
]

if (!reportFindings(release ? '公开发布门禁' : '公开内容门禁', findings)) {
  process.exitCode = 1
}
