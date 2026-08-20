import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import {
  ignoreIndexedDbIssue,
  reportIndexedDbIssue,
  type IndexedDbIssueReporter,
} from './IndexedDbAvailability'

import type { CustomerRepository } from '../../domain/customer/repository'
import { normalizeCustomerWorkspaceState } from '../../domain/customer/agreement'
import { promoteCustomerDraft } from '../../domain/customer/history'
import { createCustomerSeedState } from '../../domain/customer/seed'
import type {
  CustomerDraft,
  CustomerWorkspaceState,
} from '../../domain/customer/types'
import { migrateRetiredStateDatabase } from './legacyDatabaseMigration'

const STATE_KEY = 'current'

interface CustomerDatabase extends DBSchema {
  state: {
    key: typeof STATE_KEY
    value: CustomerWorkspaceState
  }
}

function normalizeStoredState(current: unknown): CustomerWorkspaceState {
  if (typeof current !== 'object' || current === null || Array.isArray(current)) {
    throw new Error('客户数据结构损坏，原数据未被改写。')
  }
  return normalizeCustomerWorkspaceState(current as CustomerWorkspaceState)
}

function normalizeCurrentOrSeed(current: unknown): CustomerWorkspaceState {
  return current === undefined
    ? createCustomerSeedState()
    : normalizeStoredState(current)
}

export class IndexedDbCustomerRepository implements CustomerRepository {
  private readonly databasePromise: Promise<IDBPDatabase<CustomerDatabase>>
  private database: IDBPDatabase<CustomerDatabase> | null = null

  constructor(
    databaseName = 'local-delivery-training-customers',
    reportIssue: IndexedDbIssueReporter = ignoreIndexedDbIssue,
  ) {
    const migration = databaseName === 'local-delivery-training-customers'
      ? migrateRetiredStateDatabase(databaseName, '-simulator-customers')
      : Promise.resolve()
    this.databasePromise = migration.catch(() => undefined).then(() => openDB<CustomerDatabase>(databaseName, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('state')) {
          database.createObjectStore('state')
        }
      },
      blocked: () => reportIndexedDbIssue(reportIssue, '客户数据', 'blocked'),
      blocking: () => {
        reportIndexedDbIssue(reportIssue, '客户数据', 'blocking')
        this.database?.close()
        this.database = null
      },
      terminated: () => {
        reportIndexedDbIssue(reportIssue, '客户数据', 'terminated')
        this.database = null
      },
    })).then((database) => {
      this.database = database
      return database
    }).catch((error: unknown) => {
      reportIndexedDbIssue(reportIssue, '客户数据', 'unavailable', error)
      throw error
    })
  }

  async load(): Promise<CustomerWorkspaceState> {
    const database = await this.databasePromise
    const transaction = database.transaction('state', 'readwrite')
    const current = await transaction.store.get(STATE_KEY)
    const normalized = normalizeCurrentOrSeed(current)
    await transaction.store.put(normalized, STATE_KEY)
    await transaction.done
    return structuredClone(normalized)
  }

  async saveDraft(draft: CustomerDraft): Promise<CustomerWorkspaceState> {
    const database = await this.databasePromise
    const transaction = database.transaction('state', 'readwrite')
    const current = normalizeCurrentOrSeed(await transaction.store.get(STATE_KEY))
    const next = normalizeCustomerWorkspaceState({
      ...current,
      draft: structuredClone(draft),
    })
    await transaction.store.put(next, STATE_KEY)
    await transaction.done
    return structuredClone(next)
  }

  async promoteDraft(draft: CustomerDraft): Promise<CustomerWorkspaceState> {
    const database = await this.databasePromise
    const transaction = database.transaction('state', 'readwrite')
    const current = normalizeCurrentOrSeed(await transaction.store.get(STATE_KEY))
    const next = normalizeCustomerWorkspaceState(promoteCustomerDraft(current, draft))
    await transaction.store.put(next, STATE_KEY)
    await transaction.done
    return structuredClone(next)
  }

  async restore(state: CustomerWorkspaceState): Promise<CustomerWorkspaceState> {
    const database = await this.databasePromise
    const restored = normalizeCustomerWorkspaceState(state)
    await database.put('state', restored, STATE_KEY)
    return structuredClone(restored)
  }

  async reset(): Promise<CustomerWorkspaceState> {
    const database = await this.databasePromise
    const seed = createCustomerSeedState()
    await database.put('state', seed, STATE_KEY)
    return structuredClone(seed)
  }

  async close(): Promise<void> {
    const database = await this.databasePromise
    database.close()
    this.database = null
  }
}
