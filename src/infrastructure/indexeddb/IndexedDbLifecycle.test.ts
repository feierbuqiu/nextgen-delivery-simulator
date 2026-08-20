import 'fake-indexeddb/auto'

import { deleteDB, openDB } from 'idb'
import { describe, expect, it } from 'vitest'

import type { IndexedDbIssue } from './IndexedDbAvailability'
import { IndexedDbServiceRepository } from './IndexedDbServiceRepository'

describe('IndexedDB lifecycle reporting', () => {
  it('closes a blocking connection and reports the cross-tab upgrade', async () => {
    const databaseName = `service-lifecycle-blocking-${crypto.randomUUID()}`
    const issues: IndexedDbIssue[] = []
    const repository = new IndexedDbServiceRepository(databaseName, (issue) => issues.push(issue))
    await repository.load()

    const upgraded = await openDB(databaseName, 2)
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: '业务与交割数据', kind: 'blocking' }),
    ]))
    await expect(repository.load()).rejects.toThrow()

    upgraded.close()
    await deleteDB(databaseName)
  })

  it('reports an unavailable database instead of silently using memory', async () => {
    const databaseName = `service-lifecycle-unavailable-${crypto.randomUUID()}`
    const ahead = await openDB(databaseName, 2)
    const issues: IndexedDbIssue[] = []
    const repository = new IndexedDbServiceRepository(databaseName, (issue) => issues.push(issue))

    await expect(repository.load()).rejects.toThrow()
    expect(issues.at(-1)).toMatchObject({
      source: '业务与交割数据',
      kind: 'unavailable',
    })

    ahead.close()
    await deleteDB(databaseName)
  })
})
