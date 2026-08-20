import 'fake-indexeddb/auto'

import { deleteDB, openDB } from 'idb'
import { describe, expect, it } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import type { CustomerDraft, CustomerWorkspaceState } from '../../domain/customer/types'
import { IndexedDbCustomerRepository } from './IndexedDbCustomerRepository'

describe('IndexedDbCustomerRepository', () => {
  it('rejects a damaged raw value without replacing it with customer seed data', async () => {
    const databaseName = `customer-damaged-test-${crypto.randomUUID()}`
    const rawDatabase = await openDB(databaseName, 1, {
      upgrade(database) {
        database.createObjectStore('state')
      },
    })
    await rawDatabase.put('state', 'damaged-customer-payload', 'current')
    rawDatabase.close()

    const repository = new IndexedDbCustomerRepository(databaseName)
    try {
      await expect(repository.load()).rejects.toThrow('客户数据结构损坏，原数据未被改写')
      await expect(repository.saveDraft({} as CustomerDraft)).rejects.toThrow(
        '客户数据结构损坏，原数据未被改写',
      )
      const verificationDatabase = await openDB(databaseName, 1)
      await expect(verificationDatabase.get('state', 'current')).resolves.toBe(
        'damaged-customer-payload',
      )
      verificationDatabase.close()
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })

  it('persists only the pending draft and restores deterministic fixtures', async () => {
    const databaseName = `customer-test-${crypto.randomUUID()}`
    const repository = new IndexedDbCustomerRepository(databaseName)

    try {
      const seed = await repository.load()
      expect(seed.draft).toBeNull()
      expect(seed.agreementApplications).toEqual([])
      expect(seed.senderHistory).toHaveLength(3)

      const draft: CustomerDraft = {
        productFamily: 'standard-delivery',
        destinationRegion: 'domestic',
        sender: {
          ...createEmptySender(),
          contact: '10000000016',
          detailedAddress: '瀚原省栖沄市景麓区星光路 18 号',
          identityType: 'primary',
          identityValue: '990101194912310044',
          postalCode: '110022',
        },
        recipient: createEmptyRecipient(),
        status: 'sender-ready',
        updatedAt: '2026-01-15T09:00:00.000Z',
      }
      const saved = await repository.saveDraft(draft)
      expect(saved.draft).toEqual(draft)
      expect(saved.senderHistory).toEqual(seed.senderHistory)

      const legacyOffice = "青禾支局"
      const legacyDistrict = "澜京市长风区"
      const restored = await repository.restore({
        ...saved,
        schemaVersion: 1,
        draft: saved.draft ? {
          ...saved.draft,
          sender: {
            ...saved.draft.sender,
            detailedAddress: `${legacyDistrict}星光路 18 号`,
            postalCode: '000000',
          },
        } : null,
        agreementAccounts: saved.agreementAccounts.map((account, index) => (
          index === 0 ? { ...account, name: legacyOffice } : account
        )),
      } as unknown as CustomerWorkspaceState)
      expect(restored.schemaVersion).toBe(2)
      expect(restored.agreementAccounts[0]?.name).toBe(legacyOffice)
      expect(restored.draft?.sender).toMatchObject({
        detailedAddress: '澜京市栖台区星光路 18 号',
        postalCode: '380001',
      })

      const readyDraft: CustomerDraft = {
        ...draft,
        sender: { ...draft.sender, name: '新寄件人' },
        recipient: {
          ...createEmptyRecipient(),
          name: '新收件人',
          detailedAddress: '澄岐省澄野市江洲区测试路 9 号',
        },
        status: 'customer-ready',
      }
      const promoted = await repository.promoteDraft(readyDraft)
      expect(promoted.senderHistory).toHaveLength(4)
      expect(promoted.recipientHistory).toHaveLength(4)

      const reset = await repository.reset()
      expect(reset.draft).toBeNull()
      expect(reset.senderHistory).toEqual(seed.senderHistory)
    } finally {
      await repository.close()
      await deleteDB(databaseName)
    }
  })
})
