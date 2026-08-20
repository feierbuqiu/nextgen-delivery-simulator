import { readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const assetsDirectory = resolve(projectRoot, 'dist/assets')

const limits = {
  '.css': 200 * 1024,
  '.js': 500 * 1024,
}

const findings = []
const measured = []

for (const name of readdirSync(assetsDirectory)) {
  const extension = Object.keys(limits).find((candidate) => name.endsWith(candidate))
  if (!extension) continue

  const bytes = statSync(resolve(assetsDirectory, name)).size
  measured.push({ name, bytes })
  if (bytes > limits[extension]) {
    findings.push(
      `${name}: ${(bytes / 1024).toFixed(2)} KiB，超过 ${limits[extension] / 1024} KiB`,
    )
  }
}

if (findings.length > 0) {
  console.error(`生产资源体积门禁失败：\n- ${findings.join('\n- ')}`)
  process.exitCode = 1
} else {
  const largest = measured.sort((left, right) => right.bytes - left.bytes).slice(0, 3)
  console.log(
    `生产资源体积门禁通过：${largest.map(({ name, bytes }) => (
      `${name} ${(bytes / 1024).toFixed(2)} KiB`
    )).join('；')}。`,
  )
}
