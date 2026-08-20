import type { CustomerDraft, CustomerWorkspaceState } from './types'

export interface CustomerRepository {
  load(): Promise<CustomerWorkspaceState>
  saveDraft(draft: CustomerDraft): Promise<CustomerWorkspaceState>
  promoteDraft(draft: CustomerDraft): Promise<CustomerWorkspaceState>
  restore(state: CustomerWorkspaceState): Promise<CustomerWorkspaceState>
  reset(): Promise<CustomerWorkspaceState>
}
