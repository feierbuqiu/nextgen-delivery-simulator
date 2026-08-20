import type { SimulatorState } from '../access/types'
import { migrateAccessState } from '../access/migration'
import { normalizeCustomerWorkspaceState } from '../customer/agreement'
import type { CustomerWorkspaceState } from '../customer/types'
import {
  isSupportedServiceSchemaVersion,
  migrateServiceWorkspaceState,
} from '../service/migration'
import type { ServiceWorkspaceState } from '../service/types'

export const SIMULATOR_ARCHIVE_KIND = 'nextgen-delivery-simulator-archive'
export const SIMULATOR_ARCHIVE_VERSION = 1
const RETIRED_ARCHIVE_KIND = "retired-public-namespace-simulator-archive"

export interface SimulatorArchive {
  kind: typeof SIMULATOR_ARCHIVE_KIND
  archiveVersion: typeof SIMULATOR_ARCHIVE_VERSION
  simulatorVersion: 'V0.0.10086'
  exportedAt: string
  data: {
    access: SimulatorState
    customers: CustomerWorkspaceState
    services: ServiceWorkspaceState
  }
}

export class SimulatorArchiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SimulatorArchiveError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new SimulatorArchiveError(`${label}结构无效。`)
  return value
}

function requireRecordArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new SimulatorArchiveError(`${label}结构无效。`)
  }
}

function withoutPlatformTestDuty(state: SimulatorState): SimulatorState {
  if (!state.session?.platformTestDuty) return state
  return {
    ...state,
    session: {
      ...state.session,
      platformTestDuty: null,
    },
  }
}

function validateAccessState(value: unknown): SimulatorState {
  const state = requireRecord(value, '登录数据')
  const operator = requireRecord(state.operator, '员工数据')
  if (![2, 3, 4, 5, 6, 7, 8].includes(Number(state.schemaVersion))) {
    throw new SimulatorArchiveError('登录数据版本不受支持。')
  }
  const requiredStrings = ['id', 'boundMobile', 'secretHash'] as const
  if (requiredStrings.some((key) => typeof operator[key] !== 'string')) {
    throw new SimulatorArchiveError('员工登录字段不完整。')
  }
  if (!isStringArray(operator.secretHistoryHashes)) {
    throw new SimulatorArchiveError('历史密码摘要结构无效。')
  }
  const requiredBooleans = [
    'profileCompleted',
    'requiresSecretChange',
    'requiresWorkstation',
  ] as const
  if (requiredBooleans.some((key) => typeof operator[key] !== 'boolean')) {
    throw new SimulatorArchiveError('员工状态字段不完整。')
  }
  if (operator.profile !== null && !isRecord(operator.profile)) {
    throw new SimulatorArchiveError('员工基本信息结构无效。')
  }
  if (state.session !== null) {
    const session = requireRecord(state.session, '会话数据')
    if (['operatorId', 'workstationCode', 'signedInAt'].some(
      (key) => typeof session[key] !== 'string',
    )) {
      throw new SimulatorArchiveError('会话字段不完整。')
    }
    if (Number(state.schemaVersion) >= 6 && session.platformTestDuty !== null) {
      const platformTestDuty = requireRecord(session.platformTestDuty, '平台测试值守数据')
      if (['enabledAt', 'expiresAt', 'enabledBy'].some(
        (key) => typeof platformTestDuty[key] !== 'string',
      )) {
        throw new SimulatorArchiveError('平台测试值守字段不完整。')
      }
    }
  }
  if (Number(state.schemaVersion) >= 3) {
    const security = requireRecord(state.security, '登录安全数据')
    if (!Number.isInteger(security.failedSecretAttempts) ||
        !Number.isInteger(security.nextEventSequence)) {
      throw new SimulatorArchiveError('登录安全计数字段无效。')
    }
    if (security.lockedAt !== null && typeof security.lockedAt !== 'string') {
      throw new SimulatorArchiveError('登录锁定时间字段无效。')
    }
    requireRecordArray(security.events, '登录安全审计数据')
  }
  if (Number(state.schemaVersion) >= 5) {
    for (const key of [
      'operators',
      'institutions',
      'roles',
      'roleAssignments',
      'personnelRequests',
      'attendanceRecords',
      'accessAuditEvents',
    ] as const) requireRecordArray(state[key], `${key}数据`)
    requireRecord(state.securityByOperatorId, '分员工登录安全数据')
  }
  return withoutPlatformTestDuty(
    migrateAccessState(structuredClone(state) as unknown as SimulatorState),
  )
}

function validateCustomerState(value: unknown): CustomerWorkspaceState {
  const state = requireRecord(value, '客户数据')
  if (![1, 2].includes(Number(state.schemaVersion))) {
    throw new SimulatorArchiveError('客户数据版本不受支持。')
  }
  if (state.draft !== null && !isRecord(state.draft)) {
    throw new SimulatorArchiveError('客户草稿结构无效。')
  }
  requireRecordArray(state.agreementAccounts, '协议客户数据')
  if (state.agreementApplications !== undefined) {
    requireRecordArray(state.agreementApplications, '协议客户申请数据')
  }
  requireRecordArray(state.senderHistory, '寄件人历史数据')
  requireRecordArray(state.recipientHistory, '收件人历史数据')
  return normalizeCustomerWorkspaceState(
    structuredClone(state) as unknown as CustomerWorkspaceState,
  )
}

function validateServiceState(value: unknown): ServiceWorkspaceState {
  const state = requireRecord(value, '业务数据')
  if (!isSupportedServiceSchemaVersion(state.schemaVersion)) {
    throw new SimulatorArchiveError('业务数据版本不受支持。')
  }
  const requiredCollections = ['transactions'] as const
  const optionalCollections = [
    'postalSupplySales',
    'channelProductOrders',
    'supplementaryTrafficRecords',
    'electronicCommerceRecords',
    'replyCouponRedemptions',
    'settlements',
    'personalRemittances',
    'corrections',
    'withdrawals',
    'refunds',
    'documentActions',
    'bulkBatches',
    'selfServiceImports',
    'looseMailHandovers',
    'dispatchBags',
    'dispatchBagHandovers',
    'dispatchBagChanges',
    'dispatchBagInterchangeReturns',
    'dispatchRoutes',
    'dispatchPrintRecords',
    'postageMeterDevices',
    'postageMeterBatches',
    'postageMeterRegistrations',
    'postageMeterDailyBalances',
    'postageMeterMailHandovers',
    'postageMeterFundingRequests',
    'postageMeterRepairRequests',
    'postageMeterDeviceHandoverHistory',
    'specialHandlingApplications',
    'windowDeliveryBags',
    'windowDeliveryItems',
    'windowDeliverySequenceStarts',
    'windowDeliveryAudits',
    'postalSupplyInventoryBalances',
    'postalSupplyDocuments',
    'pointsProductInventory',
    'pointsInventoryMovements',
    'spotCheckExercises',
  ] as const
  for (const key of requiredCollections) requireRecordArray(state[key], '业务交易数据')
  for (const key of optionalCollections) {
    if (state[key] !== undefined) requireRecordArray(state[key], `${key}数据`)
  }
  if (state.draft !== null && state.draft !== undefined && !isRecord(state.draft)) {
    throw new SimulatorArchiveError('业务草稿结构无效。')
  }
  return migrateServiceWorkspaceState(structuredClone(state))
}

export function createSimulatorArchive(
  access: SimulatorState,
  customers: CustomerWorkspaceState,
  services: ServiceWorkspaceState,
  exportedAt = new Date().toISOString(),
): SimulatorArchive {
  return {
    kind: SIMULATOR_ARCHIVE_KIND,
    archiveVersion: SIMULATOR_ARCHIVE_VERSION,
    simulatorVersion: 'V0.0.10086',
    exportedAt,
    data: {
      access: withoutPlatformTestDuty(migrateAccessState(structuredClone(access))),
      customers: normalizeCustomerWorkspaceState(structuredClone(customers)),
      services: migrateServiceWorkspaceState(structuredClone(services)),
    },
  }
}

export function parseSimulatorArchive(source: string): SimulatorArchive {
  let value: unknown
  try {
    value = JSON.parse(source) as unknown
  } catch {
    throw new SimulatorArchiveError('所选文件不是有效的 JSON 数据。')
  }

  const archive = requireRecord(value, '备份文件')
  if (archive.kind !== SIMULATOR_ARCHIVE_KIND && archive.kind !== RETIRED_ARCHIVE_KIND) {
    throw new SimulatorArchiveError('所选文件不是本模拟器生成的备份。')
  }
  if (archive.archiveVersion !== SIMULATOR_ARCHIVE_VERSION) {
    throw new SimulatorArchiveError('备份文件版本不受支持。')
  }
  if (typeof archive.exportedAt !== 'string' || Number.isNaN(Date.parse(archive.exportedAt))) {
    throw new SimulatorArchiveError('备份时间字段无效。')
  }
  const data = requireRecord(archive.data, '备份数据')
  return {
    kind: SIMULATOR_ARCHIVE_KIND,
    archiveVersion: SIMULATOR_ARCHIVE_VERSION,
    simulatorVersion: 'V0.0.10086',
    exportedAt: archive.exportedAt,
    data: {
      access: validateAccessState(data.access),
      customers: validateCustomerState(data.customers),
      services: validateServiceState(data.services),
    },
  }
}
