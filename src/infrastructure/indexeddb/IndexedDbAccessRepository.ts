import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import {
  ignoreIndexedDbIssue,
  reportIndexedDbIssue,
  type IndexedDbIssueReporter,
} from './IndexedDbAvailability'

import type { AccessRepository } from '../../domain/access/repository'
import { replaceOperator } from '../../domain/access/authorization'
import { migrateAccessState } from '../../domain/access/migration'
import {
  DEMO_TEMPORARY_SECRET_HASH,
  createSeedState,
} from '../../domain/access/seed'
import type { SimulatorState } from '../../domain/access/types'
import { migrateRetiredStateDatabase } from './legacyDatabaseMigration'

const STATE_KEY = 'current'

interface SimulatorDatabase extends DBSchema {
  state: {
    key: typeof STATE_KEY
    value: SimulatorState
  }
}

function migrateState(current: SimulatorState): SimulatorState {
  const storedSchemaVersion = Number(
    (current as unknown as { schemaVersion?: number }).schemaVersion ?? 1,
  )
  let migrated = migrateAccessState(current)
  if (storedSchemaVersion < 2 && migrated.operator.requiresSecretChange) {
    migrated = replaceOperator(migrated, {
      ...migrated.operator,
      secretHash: DEMO_TEMPORARY_SECRET_HASH,
      secretHistoryHashes: Array.from(new Set([
        ...migrated.operator.secretHistoryHashes,
        migrated.operator.secretHash,
        DEMO_TEMPORARY_SECRET_HASH,
      ])),
    })
    migrated = migrateAccessState(migrated)
  }
  return migrated
}

function migrateStoredState(current: unknown): SimulatorState {
  if (typeof current !== 'object' || current === null || Array.isArray(current)) {
    throw new Error('登录与权限数据结构损坏，原数据未被改写。')
  }
  return migrateState(current as SimulatorState)
}

export class IndexedDbAccessRepository implements AccessRepository {
  private readonly databasePromise: Promise<IDBPDatabase<SimulatorDatabase>>
  private database: IDBPDatabase<SimulatorDatabase> | null = null

  constructor(
    databaseName = 'local-delivery-training-access',
    reportIssue: IndexedDbIssueReporter = ignoreIndexedDbIssue,
  ) {
    const migration = databaseName === 'local-delivery-training-access'
      ? migrateRetiredStateDatabase(databaseName, '-simulator')
      : Promise.resolve()
    this.databasePromise = migration.catch(() => undefined).then(() => openDB<SimulatorDatabase>(databaseName, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('state')) {
          database.createObjectStore('state')
        }
      },
      blocked: () => reportIndexedDbIssue(reportIssue, '登录与权限数据', 'blocked'),
      blocking: () => {
        reportIndexedDbIssue(reportIssue, '登录与权限数据', 'blocking')
        this.database?.close()
        this.database = null
      },
      terminated: () => {
        reportIndexedDbIssue(reportIssue, '登录与权限数据', 'terminated')
        this.database = null
      },
    })).then((database) => {
      this.database = database
      return database
    }).catch((error: unknown) => {
      reportIndexedDbIssue(reportIssue, '登录与权限数据', 'unavailable', error)
      throw error
    })
  }

  async load(): Promise<SimulatorState> {
    const database = await this.databasePromise
    const seed = await createSeedState()
    const transaction = database.transaction('state', 'readwrite')
    const current = await transaction.store.get(STATE_KEY)
    const migrated = current !== undefined
      ? migrateStoredState(current)
      : seed
    await transaction.store.put(migrated, STATE_KEY)
    await transaction.done
    return structuredClone(migrated)
  }

  async save(state: SimulatorState): Promise<void> {
    const database = await this.databasePromise
    await database.put(
      'state',
      migrateAccessState(structuredClone(state)),
      STATE_KEY,
    )
  }

  async restore(state: SimulatorState): Promise<SimulatorState> {
    const database = await this.databasePromise
    const restored = migrateAccessState(structuredClone(state))
    await database.put('state', restored, STATE_KEY)
    return structuredClone(restored)
  }

  async reset(): Promise<SimulatorState> {
    const database = await this.databasePromise
    const seed = await createSeedState()
    await database.put('state', seed, STATE_KEY)
    return structuredClone(seed)
  }

  async close(): Promise<void> {
    const database = await this.databasePromise
    database.close()
    this.database = null
  }
}
