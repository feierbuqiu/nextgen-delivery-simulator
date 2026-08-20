import { deleteDB, openDB, type DBSchema } from 'idb'

const STATE_KEY = 'current'
const RETIRED_NAMESPACE = "retired-public-namespace"

interface StateDatabase extends DBSchema {
  state: {
    key: string
    value: unknown
  }
}

function retiredDatabaseName(suffix: string): string {
  return `${RETIRED_NAMESPACE}${suffix}`
}

async function databaseNames(): Promise<Set<string> | null> {
  if (typeof indexedDB.databases !== 'function') return null
  const databases = await indexedDB.databases()
  return new Set(databases.flatMap((database) => database.name ? [database.name] : []))
}

/**
 * Copies the single persisted application state out of a retired branded database.
 * The retired database is removed only after the copied value can be read back.
 */
export async function migrateRetiredStateDatabase(
  currentName: string,
  retiredSuffix: string,
): Promise<void> {
  const retiredName = retiredDatabaseName(retiredSuffix)
  const names = await databaseNames()
  if (names === null || !names.has(retiredName)) return

  const retired = await openDB<StateDatabase>(retiredName)
  if (!retired.objectStoreNames.contains('state')) {
    retired.close()
    return
  }

  const retiredState = await retired.get('state', STATE_KEY)
  if (retiredState === undefined) {
    retired.close()
    return
  }

  const current = await openDB<StateDatabase>(currentName, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('state')) {
        database.createObjectStore('state')
      }
    },
  })
  const existingState = await current.get('state', STATE_KEY)
  if (existingState !== undefined) {
    current.close()
    retired.close()
    return
  }

  await current.put('state', structuredClone(retiredState), STATE_KEY)
  const verifiedState = await current.get('state', STATE_KEY)
  current.close()
  retired.close()
  if (verifiedState !== undefined) await deleteDB(retiredName)
}
