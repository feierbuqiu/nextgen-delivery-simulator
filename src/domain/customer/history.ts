import type {
  CustomerContact,
  CustomerDraft,
  CustomerHistoryRecord,
  CustomerWorkspaceState,
} from './types'

function normalizedContact(contact: CustomerContact): Omit<CustomerHistoryRecord, 'id'> {
  return {
    contact: contact.contact.trim(),
    name: contact.name.trim(),
    detailedAddress: contact.detailedAddress.trim(),
    unit: contact.unit.trim(),
    postalCode: contact.postalCode.trim(),
  }
}

function recordMatches(
  record: CustomerHistoryRecord,
  candidate: Omit<CustomerHistoryRecord, 'id'>,
): boolean {
  return (
    record.contact === candidate.contact &&
    record.name === candidate.name &&
    record.detailedAddress === candidate.detailedAddress &&
    record.unit === candidate.unit &&
    record.postalCode === candidate.postalCode
  )
}

function appendUnique(
  records: CustomerHistoryRecord[],
  contact: CustomerContact,
  prefix: 'sender' | 'recipient',
): CustomerHistoryRecord[] {
  const candidate = normalizedContact(contact)
  if (Object.values(candidate).every((value) => value === '')) return records
  if (records.some((record) => recordMatches(record, candidate))) return records
  const nextNumber = records.reduce((maximum, record) => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(record.id)
    return Math.max(maximum, match ? Number(match[1]) : 0)
  }, 0) + 1
  return [
    ...records,
    { id: `${prefix}-${String(nextNumber).padStart(3, '0')}`, ...candidate },
  ]
}

export function promoteCustomerDraft(
  state: CustomerWorkspaceState,
  draft: CustomerDraft,
): CustomerWorkspaceState {
  return {
    ...state,
    senderHistory: appendUnique(state.senderHistory, draft.sender, 'sender'),
    recipientHistory: appendUnique(
      state.recipientHistory,
      draft.recipient,
      'recipient',
    ),
  }
}
