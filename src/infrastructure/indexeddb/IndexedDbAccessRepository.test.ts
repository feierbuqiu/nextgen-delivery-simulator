import 'fake-indexeddb/auto'

import { deleteDB, openDB } from 'idb'
import { describe, expect, it } from 'vitest'

import { hashSecret } from '../../domain/access/policy'
import { DEMO_TEMPORARY_SECRET } from '../../domain/access/seed'
import type { DemoOperator, SimulatorState } from '../../domain/access/types'
import { IndexedDbAccessRepository } from './IndexedDbAccessRepository'

describe('IndexedDbAccessRepository', () => {
  it('rejects a damaged raw value without replacing it with access seed data', async () => {
    const databaseName = `simulator-damaged-test-${crypto.randomUUID()}`
    const rawDatabase = await openDB(databaseName, 1, {
      upgrade(database) {
        database.createObjectStore('state')
      },
    })
    await rawDatabase.put('state', 'damaged-access-payload', 'current')
    rawDatabase.close()

    const repository = new IndexedDbAccessRepository(databaseName)
    try {
      await expect(repository.load()).rejects.toThrow(
        '登录与权限数据结构损坏，原数据未被改写',
      )
      const verificationDatabase = await openDB(databaseName, 1)
      await expect(verificationDatabase.get('state', 'current')).resolves.toBe(
        'damaged-access-payload',
      )
      verificationDatabase.close()
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('seeds, persists, and resets the simulator state', async () => {
    const databaseName = `simulator-test-${crypto.randomUUID()}`
    const repository = new IndexedDbAccessRepository(databaseName)

    try {
      const seed = await repository.load()
      expect(seed.schemaVersion).toBe(8)
      expect(seed.operators.map((operator) => operator.id)).toEqual([
        '80000001',
        '81000001',
        '84000001',
        '90000001',
        '91000001',
        '92000001',
      ])
      expect(seed.operator.profileCompleted).toBe(false)
      expect(seed.operator.secretHistoryHashes).toEqual([seed.operator.secretHash])
      expect(seed.session).toBeNull()
      expect(seed.roles.find((role) => role.id === 'counter-operator')?.permissions)
        .toContain('workspace.channel.dispatch')

      const changed = {
        ...seed,
        operator: { ...seed.operator, profileCompleted: true },
        roles: seed.roles.map((role) => role.id === 'counter-operator'
          ? {
            ...role,
            permissions: role.permissions.filter((permission) => (
              permission !== 'workspace.channel.dispatch'
            )),
          }
          : role),
      }
      await repository.save(changed)
      const reloaded = await repository.load()
      expect(reloaded).toMatchObject({
        operator: { profileCompleted: true },
      })
      expect(reloaded.roles.find((role) => role.id === 'counter-operator')?.permissions)
        .toContain('workspace.channel.dispatch')

      const reset = await repository.reset()
      expect(reset.operator.profileCompleted).toBe(false)
      expect(reset.session).toBeNull()
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('migrates a legacy record into password history without losing state', async () => {
    const databaseName = `simulator-migration-test-${crypto.randomUUID()}`
    const repository = new IndexedDbAccessRepository(databaseName)

    try {
      const seed = await repository.load()
      const legacySecretHash = await hashSecret('Legacy!Start26')
      const legacyOperator = { ...seed.operator } as Partial<DemoOperator>
      delete legacyOperator.secretHistoryHashes
      legacyOperator.secretHash = legacySecretHash
      const legacy = {
        ...seed,
        schemaVersion: 1,
        operator: legacyOperator,
      } as unknown as SimulatorState
      delete (legacy as unknown as { security?: unknown }).security
      const database = await openDB(databaseName, 1)
      await database.put('state', legacy, 'current')
      database.close()

      const migrated = await repository.load()
      const defaultSecretHash = await hashSecret(DEMO_TEMPORARY_SECRET)
      expect(migrated.schemaVersion).toBe(8)
      expect(migrated.operator.secretHash).toBe(defaultSecretHash)
      expect(migrated.operator.secretHistoryHashes).toEqual([
        legacySecretHash,
        defaultSecretHash,
      ])
      expect(migrated.operator.profileCompleted).toBe(false)
      expect(migrated.security).toEqual({
        failedSecretAttempts: 0,
        lockedAt: null,
        nextEventSequence: 1,
        events: [],
      })
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('preserves public-safe institution text without clearing the operator state', async () => {
    const databaseName = `simulator-public-text-test-${crypto.randomUUID()}`
    const repository = new IndexedDbAccessRepository(databaseName)
    const legacyOffice = "青禾支局"

    try {
      const seed = await repository.load()
      await repository.save({
        ...seed,
        schemaVersion: 3,
        operator: {
          ...seed.operator,
          profileCompleted: true,
          profile: { institutionName: legacyOffice },
        },
      } as unknown as SimulatorState)

      await expect(repository.load()).resolves.toMatchObject({
        schemaVersion: 8,
        operator: {
          profileCompleted: true,
          profile: { institutionName: legacyOffice },
        },
      })
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })
})
