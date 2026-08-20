import { readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const sourceRoot = resolve(projectRoot, 'src')
const sourceExtensions = new Set(['.ts', '.tsx'])

function collectSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(path)
    if (!sourceExtensions.has(extname(entry.name))) return []
    if (/\.test\.[^.]+$/.test(entry.name)) return []
    if (relative(sourceRoot, path).replaceAll('\\', '/').startsWith('test/')) return []
    return [path]
  })
}

function sourceLayer(path) {
  const [first] = relative(sourceRoot, path).replaceAll('\\', '/').split('/')
  return first ?? ''
}

function resolveImportLayer(file, specifier) {
  if (!specifier.startsWith('.')) return null
  const importedPath = resolve(dirname(file), specifier)
  const importedRelativePath = relative(sourceRoot, importedPath).replaceAll('\\', '/')
  if (importedRelativePath.startsWith('../')) return null
  return sourceLayer(importedPath)
}

const forbiddenLayerImports = {
  domain: new Set(['app', 'features', 'infrastructure', 'ui']),
  features: new Set(['app', 'infrastructure']),
  infrastructure: new Set(['app', 'features']),
  ui: new Set(['app', 'domain', 'features', 'infrastructure']),
}

const importPattern = /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)['"]([^'"]+)['"]/gu
const utcDateTruncationPattern = /\.(?:slice|substring)\(\s*0\s*,\s*10\s*\)|\.split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]/gu
const findings = []

for (const file of collectSourceFiles(sourceRoot)) {
  const layer = sourceLayer(file)
  const forbidden = forbiddenLayerImports[layer]
  if (!forbidden) continue

  const content = readFileSync(file, 'utf8')
  if ((layer === 'domain' || layer === 'features') && utcDateTruncationPattern.test(content)) {
    findings.push({
      kind: 'business-day',
      file: relative(projectRoot, file).replaceAll('\\', '/'),
    })
  }
  utcDateTruncationPattern.lastIndex = 0
  for (const match of content.matchAll(importPattern)) {
    const specifier = match[1]
    const importedLayer = resolveImportLayer(file, specifier)
    if (importedLayer && forbidden.has(importedLayer)) {
      findings.push({
        file: relative(projectRoot, file).replaceAll('\\', '/'),
        layer,
        importedLayer,
        specifier,
      })
    }

    if (layer === 'domain' && ['react', 'react-dom', 'idb'].some((runtime) => (
      specifier === runtime || specifier.startsWith(`${runtime}/`)
    ))) {
      findings.push({
        file: relative(projectRoot, file).replaceAll('\\', '/'),
        layer,
        importedLayer: '外部运行时',
        specifier,
      })
    }
  }
}

if (findings.length > 0) {
  console.error(`架构边界检查失败：发现 ${findings.length} 个反向依赖。`)
  for (const finding of findings) {
    if (finding.kind === 'business-day') {
      console.error(`- ${finding.file}: 业务代码不得截断 UTC 字符串取日期，请使用 businessCalendarDay。`)
      continue
    }
    console.error(
      `- ${finding.file}: ${finding.layer} 不得导入 ${finding.importedLayer} ` +
      `(${finding.specifier})`,
    )
  }
  process.exitCode = 1
} else {
  console.log('架构边界检查通过：领域、功能、基础设施与通用界面依赖方向正确。')
}
