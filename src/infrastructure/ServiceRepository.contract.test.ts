import 'fake-indexeddb/auto'

import { deleteDB } from 'idb'
import { describe, expect, it } from 'vitest'

import { createEmptyRecipient, createEmptySender } from '../domain/customer/seed'
import { calculateServiceCharge } from '../domain/service/policy'
import type { ServiceRepository } from '../domain/service/repository'
import {
  createEmptyServiceDraft,
  createServiceSeedState,
  SERVICE_PRODUCTS,
} from '../domain/service/seed'
import { acceptServiceTransaction } from '../domain/service/transactions'
import type { AcceptServiceRequest, ServiceWorkspaceState } from '../domain/service/types'
import { IndexedDbServiceRepository } from './indexeddb/IndexedDbServiceRepository'
import { MemoryServiceRepository } from './memory/MemoryServiceRepository'

interface RepositoryHarness {
  repository: ServiceRepository
  dispose(): Promise<void>
}

interface RepositoryFactory {
  name: string
  create(): Promise<RepositoryHarness>
}

const factories: RepositoryFactory[] = [
  {
    name: 'memory',
    async create() {
      return {
        repository: MemoryServiceRepository.create(),
        async dispose() {},
      }
    },
  },
  {
    name: 'IndexedDB',
    async create() {
      const databaseName = `service-contract-${crypto.randomUUID()}`
      const repository = new IndexedDbServiceRepository(databaseName)
      return {
        repository,
        async dispose() {
          await repository.close()
          await deleteDB(databaseName)
        },
      }
    },
  },
]

const product = SERVICE_PRODUCTS[0]!

function acceptanceRequest(
  itemCode: string,
  acceptedAt = '2026-08-19T09:20:00.000+10:00',
): AcceptServiceRequest {
  const draft = {
    ...createEmptyServiceDraft(false),
    productId: product.id,
    itemCode,
    weightGrams: 20,
  }
  return {
    acceptedAt,
    charge: calculateServiceCharge(draft, product),
    customer: {
      productFamily: 'basic-letter',
      destinationRegion: 'domestic',
      sender: {
        ...createEmptySender(),
        name: '契约演练寄件人',
        detailedAddress: '瀚原省栖沄市景麓区新程路 1 号',
      },
      recipient: {
        ...createEmptyRecipient(),
        name: '契约演练收件人',
        detailedAddress: '澄岐省澄野市江洲区远帆路 2 号',
      },
    },
    draft,
    product,
  }
}

async function withRepository(
  factory: RepositoryFactory,
  assertion: (repository: ServiceRepository) => Promise<void>,
): Promise<void> {
  const harness = await factory.create()
  try {
    await assertion(harness.repository)
  } finally {
    await harness.dispose()
  }
}

describe.each(factories)('$name service repository contract', (factory) => {
  it('returns isolated snapshots and persists drafts', async () => {
    await withRepository(factory, async (repository) => {
      const initial = await repository.load()
      initial.nextSequence = 999

      expect((await repository.load()).nextSequence).toBe(1)

      const draft = acceptanceRequest('7000818317001').draft
      await repository.saveDraft(draft)
      expect((await repository.load()).draft).toEqual(draft)
    })
  })

  it('persists the core intake, settlement and invoice-decision path', async () => {
    await withRepository(factory, async (repository) => {
      const accepted = await repository.accept(acceptanceRequest('7000818317002'))
      const settled = await repository.settle({
        transactionIds: [accepted.transaction.id],
        tender: 'cash',
        settledAt: '2026-08-19T09:30:00.000+10:00',
        amountReceivedCents: accepted.transaction.charge.settlementDueCents,
      })
      await repository.recordInvoiceDecision(settled.settlement.id, false)

      await expect(repository.load()).resolves.toMatchObject({
        nextSequence: 2,
        nextSettlementSequence: 2,
        draft: null,
        transactions: [{
          id: 'SIM-20260819-000001',
          status: 'settled',
          settlementId: 'JS-20260819-000001',
        }],
        settlements: [{
          id: 'JS-20260819-000001',
          invoiceRequested: false,
        }],
      })
    })
  })

  it('migrates restored history and continues after its highest retained number', async () => {
    await withRepository(factory, async (repository) => {
      const historical = acceptServiceTransaction(
        createServiceSeedState(),
        acceptanceRequest('7000818317003', '2026-08-18T09:20:00.000+10:00'),
      ).state
      const stale = structuredClone(historical) as unknown as Record<string, unknown>
      stale.schemaVersion = 32
      stale.nextSequence = 1

      const restored = await repository.restore(stale as unknown as ServiceWorkspaceState)
      expect(restored).toMatchObject({ schemaVersion: 38, nextSequence: 2 })

      const accepted = await repository.accept(
        acceptanceRequest('7000818317004', '2026-08-19T10:00:00.000+10:00'),
      )
      expect(accepted.transaction.id).toBe('SIM-20260819-000002')
    })
  })

  it('does not persist a partially attempted invalid mutation', async () => {
    await withRepository(factory, async (repository) => {
      const before = await repository.load()

      await expect(repository.settle({
        transactionIds: ['SIM-20260819-999999'],
        tender: 'cash',
        settledAt: '2026-08-19T11:00:00.000+10:00',
        amountReceivedCents: 0,
      })).rejects.toThrow()

      expect(await repository.load()).toEqual(before)
    })
  })

  it('rejects an unknown backup schema without replacing current data', async () => {
    await withRepository(factory, async (repository) => {
      await repository.accept(acceptanceRequest('7000818317006'))
      const before = await repository.load()
      const unknown = structuredClone(before) as unknown as Record<string, unknown>
      unknown.schemaVersion = 99

      await expect(repository.restore(
        unknown as unknown as ServiceWorkspaceState,
      )).rejects.toThrow('业务数据版本 99 不受支持，原数据未被改写')

      expect(await repository.load()).toEqual(before)
    })
  })

  it('resets every persisted mutation to the current seed state', async () => {
    await withRepository(factory, async (repository) => {
      await repository.accept(acceptanceRequest('7000818317005'))

      const reset = await repository.reset()
      expect(reset).toEqual(createServiceSeedState())
      expect(await repository.load()).toEqual(createServiceSeedState())
    })
  })
})
