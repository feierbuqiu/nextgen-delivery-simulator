import { resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

function numericVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(value)
  return match ? match.slice(1).map(Number) : null
}

export function isSupportedNodeRuntime(value = process.versions.node) {
  const version = numericVersion(value)
  if (!version) return false
  const [major, minor, patch] = version
  if (major === 22) return minor > 22 || (minor === 22 && patch >= 2)
  if (major === 24) return minor > 15 || (minor === 15 && patch >= 0)
  return major >= 26
}

export function assertSupportedNodeRuntime(value = process.versions.node) {
  if (isSupportedNodeRuntime(value)) return
  throw new Error(
    `当前 Node.js ${value} 不受支持。请使用仓库 .node-version 指定的 22.22.2，` +
    '或 Node.js 24.15.0 及以上受支持版本；不要使用 Node.js 25。',
  )
}

const invokedUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : ''

if (import.meta.url === invokedUrl) {
  try {
    assertSupportedNodeRuntime()
    console.log(`Node.js 运行时检查通过：${process.versions.node}。`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
