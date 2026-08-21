import { randomUUID } from 'node:crypto'
import { renameSync, unlinkSync, writeFileSync } from 'node:fs'

export function atomicWriteFileSync(targetPath, content) {
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
    renameSync(temporaryPath, targetPath)
  } finally {
    try {
      unlinkSync(temporaryPath)
    } catch {
      // rename 成功后临时文件已不存在；失败时尽力清理。
    }
  }
}
