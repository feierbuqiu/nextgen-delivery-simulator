import type { AccessRepository } from '../../domain/access/repository'
import { migrateAccessState } from '../../domain/access/migration'
import { createSeedState } from '../../domain/access/seed'
import type { SimulatorState } from '../../domain/access/types'
import { sanitizePublicProductData } from '../../domain/desensitization/publicText'

function cloneState(state: SimulatorState): SimulatorState {
  return structuredClone(state)
}

export class MemoryAccessRepository implements AccessRepository {
  private constructor(private state: SimulatorState) {}

  static async create(): Promise<MemoryAccessRepository> {
    return new MemoryAccessRepository(await createSeedState())
  }

  async load(): Promise<SimulatorState> {
    return cloneState(this.state)
  }

  async save(state: SimulatorState): Promise<void> {
    this.state = sanitizePublicProductData(migrateAccessState(cloneState(state)))
  }

  async restore(state: SimulatorState): Promise<SimulatorState> {
    this.state = sanitizePublicProductData(migrateAccessState(cloneState(state)))
    return cloneState(this.state)
  }

  async reset(): Promise<SimulatorState> {
    this.state = await createSeedState()
    return cloneState(this.state)
  }
}
