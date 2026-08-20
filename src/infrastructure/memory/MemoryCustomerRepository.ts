import type { CustomerRepository } from '../../domain/customer/repository'
import { normalizeCustomerWorkspaceState } from '../../domain/customer/agreement'
import { promoteCustomerDraft } from '../../domain/customer/history'
import { createCustomerSeedState } from '../../domain/customer/seed'
import type {
  CustomerDraft,
  CustomerWorkspaceState,
} from '../../domain/customer/types'

function cloneState(state: CustomerWorkspaceState): CustomerWorkspaceState {
  return structuredClone(state)
}

export class MemoryCustomerRepository implements CustomerRepository {
  private constructor(private state: CustomerWorkspaceState) {}

  static create(): MemoryCustomerRepository {
    return new MemoryCustomerRepository(createCustomerSeedState())
  }

  async load(): Promise<CustomerWorkspaceState> {
    this.state = normalizeCustomerWorkspaceState(this.state)
    return cloneState(this.state)
  }

  async saveDraft(draft: CustomerDraft): Promise<CustomerWorkspaceState> {
    this.state = { ...this.state, draft: structuredClone(draft) }
    return cloneState(this.state)
  }

  async promoteDraft(draft: CustomerDraft): Promise<CustomerWorkspaceState> {
    this.state = promoteCustomerDraft(this.state, draft)
    return cloneState(this.state)
  }

  async restore(state: CustomerWorkspaceState): Promise<CustomerWorkspaceState> {
    this.state = normalizeCustomerWorkspaceState(state)
    return cloneState(this.state)
  }

  async reset(): Promise<CustomerWorkspaceState> {
    this.state = createCustomerSeedState()
    return cloneState(this.state)
  }
}
