import 'fake-indexeddb/auto'

import { deleteDB, openDB } from 'idb'
import { afterEach, describe, expect, it } from 'vitest'

import { migrateRetiredStateDatabase } from './legacyDatabaseMigration'

const retiredRoot = "retired-public-namespace"
const suffix = `-migration-test-${crypto.randomUUID()}`
const retiredName = `${retiredRoot}${suffix}`
const currentName = `local-delivery-migration-test-${crypto.randomUUID()}`

afterEach(async () => {
  await Promise.all([deleteDB(retiredName), deleteDB(currentName)])
})

describe('retired database migration', () => {
  it('copies, verifies, and removes a retired local state database', async () => {
    const retired = await openDB(retiredName, 1, {
      upgrade(database) {
        database.createObjectStore('state')
      },
    })
    await retired.put('state', { retained: true }, 'current')
    retired.close()

    await migrateRetiredStateDatabase(currentName, suffix)

    const current = await openDB(currentName)
    await expect(current.get('state', 'current')).resolves.toEqual({ retained: true })
    current.close()
    await expect(indexedDB.databases()).resolves.not.toContainEqual(
      expect.objectContaining({ name: retiredName }),
    )
  })
})
