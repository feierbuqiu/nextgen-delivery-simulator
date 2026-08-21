import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  inspectPublicEntries,
  loadWorkingTree,
} from './publication-rules.mjs'

test('working-tree scan rejects a directory symlink before following it', () => {
  const root = mkdtempSync(join(tmpdir(), 'publication-tree-'))
  const outside = mkdtempSync(join(tmpdir(), 'publication-outside-'))
  try {
    writeFileSync(join(outside, 'outside.txt'), 'outside')
    mkdirSync(join(root, 'safe'))
    writeFileSync(join(root, 'safe', 'inside.txt'), 'inside')
    symlinkSync(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')

    const loaded = loadWorkingTree(root)

    assert.ok(loaded.findings.some((finding) => finding.includes('linked：公开仓库不接受符号链接')))
    assert.equal(loaded.entries.has('linked/outside.txt'), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('publication text scan detects forward-slash Windows user paths', () => {
  const windowsUserPath = ['C:', 'Users', 'example', 'private.txt'].join('/')
  const findings = inspectPublicEntries(new Map([
    ['example.txt', Buffer.from(windowsUserPath)],
  ]))

  assert.ok(findings.some((finding) => finding.includes('发现本机绝对路径')))
})
