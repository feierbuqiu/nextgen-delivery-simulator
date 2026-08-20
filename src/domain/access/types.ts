export type PersonnelType =
  | 'contract-a'
  | 'contract-b'
  | 'labor-employment'
  | 'labor-contracting'
  | 'part-time'
  | 'business-outsourcing'
  | 'commissioned-services'

export interface OperatorProfile {
  displayName: string
  nameAbbreviation: string
  identityCode: string
  gender: string
  personnelStatus: string
  birthDate: string
  phone: string
  institutionCode: string
  institutionName: string
  employedDate: string
  serviceYears: string
  arrivalDate: string
  departureDate: string
  mentalOutlook: string
  personnelType: PersonnelType
  workplaceRole: string
  jobCategory: string
  directSupervisor: string
  educationLevel: string
  professionalQualification: string
  reliefPermission: string
  jobInformation: string
  reliefEligible: boolean
  reliefRoleIds: string[]
  receiveSmsType: string
  receiveSmsTime: string
  responsibleStoreOutlet: string
  performanceSourceOutlet: string
  performanceEvaluation: string
}

export interface DemoOperator {
  id: string
  boundMobile: string
  secretHash: string
  secretHistoryHashes: string[]
  accountStatus: 'active' | 'disabled'
  profileCompleted: boolean
  requiresSecretChange: boolean
  requiresWorkstation: boolean
  profile: OperatorProfile | null
}

export type InstitutionLevel = 'group' | 'province' | 'prefecture' | 'county' | 'outlet'

export interface AccessInstitution {
  code: string
  name: string
  parentCode: string | null
  level: InstitutionLevel
  status: 'active' | 'inactive'
}

export type AccessPermission =
  | 'workspace.dashboard'
  | 'workspace.channel.access'
  | 'workspace.channel.core'
  | 'workspace.channel.bulk'
  | 'workspace.channel.dispatch'
  | 'workspace.channel.dispatch.handover'
  | 'workspace.channel.dispatch.handover-out'
  | 'workspace.channel.dispatch.handover-in'
  | 'workspace.channel.dispatch.sealing'
  | 'workspace.channel.dispatch.routing'
  | 'workspace.channel.dispatch.transport'
  | 'workspace.channel.dispatch.query'
  | 'workspace.channel.dispatch.interchange-return'
  | 'workspace.channel.special'
  | 'workspace.channel.window-delivery'
  | 'workspace.channel.postage-meter'
  | 'workspace.channel.postal-supply'
  | 'workspace.channel.invoice'
  | 'workspace.channel.query'
  | 'workspace.channel.points'
  | 'workspace.periodicals'
  | 'workspace.accounting'
  | 'workspace.philately'
  | 'workspace.distribution'
  | 'workspace.insurance'
  | 'management.basic.access'
  | 'management.basic.personnel'
  | 'management.basic.roles'
  | 'management.basic.dispatch-relations'
  | 'management.business.access'
  | 'management.business.attendance.read'
  | 'management.business.attendance.operate'
  | 'management.business.on-site-authorization'
  | 'management.business.personnel-approval'
  | 'management.business.role-approval'
  | 'management.permission.request'

export interface AccessRole {
  id: string
  name: string
  system: 'production' | 'management' | 'app'
  level: InstitutionLevel
  permissions: AccessPermission[]
  custom: boolean
  status: 'active' | 'inactive'
}

export interface AccessRoleAssignment {
  id: string
  operatorId: string
  roleId: string
  institutionCode: string
  dataScope: 'self' | 'institution' | 'subordinate'
  status: 'active' | 'inactive'
  assignedAt: string
  assignedBy: string
}

export type PersonnelRequestKind =
  | 'new-employee'
  | 'profile-change'
  | 'role-change'
  | 'deactivation'

export type PersonnelRequestStatus = 'pending' | 'approved' | 'rejected'

export interface ProposedEmployee {
  id: string
  boundMobile: string
  requiresWorkstation: boolean
  profile: OperatorProfile
}

export interface PersonnelRequest {
  id: string
  kind: PersonnelRequestKind
  applicantOperatorId: string
  targetOperatorId: string
  requestedRoleId: string | null
  proposedProfile: OperatorProfile | null
  proposedEmployee: ProposedEmployee | null
  reason: string
  status: PersonnelRequestStatus
  submittedAt: string
  reviewedAt: string | null
  reviewedBy: string | null
  reviewComment: string
}

export interface AttendanceRecord {
  id: string
  workDate: string
  institutionCode: string
  institutionName: string
  operatorId: string
  operatorName: string
  workstationCode: string
  institutionSignedInAt: string
  institutionSignedInBy?: string
  institutionSignedOutAt: string | null
  employeeSignedInAt: string
  employeeSignedOutAt: string | null
  institutionSignOutCancelledAt: string | null
  employeeSignOutCancelledAt: string | null
}

export type AccessAuditAction =
  | 'employee-signed-in'
  | 'employee-signed-out'
  | 'employee-sign-out-cancelled'
  | 'institution-signed-in'
  | 'institution-signed-out'
  | 'institution-sign-out-cancelled'
  | 'on-site-action-authorized'
  | 'internal-handover-authorized'
  | 'dispatch-relation-management-authorized'
  | 'personal-profile-updated'
  | 'personnel-request-submitted'
  | 'personnel-request-approved'
  | 'personnel-request-rejected'
  | 'platform-test-duty-enabled'
  | 'platform-test-duty-ended'

export interface AccessAuditEvent {
  id: string
  action: AccessAuditAction
  occurredAt: string
  actorId: string
  targetId: string
  detail: string
}

export type AccessUnlockMethod = 'supervisor-credentials'

export type AccessSecurityEventType =
  | 'credential-failed'
  | 'account-locked'
  | 'account-unlocked'
  | 'secret-recovered'

export interface AccessSecurityEvent {
  id: string
  type: AccessSecurityEventType
  occurredAt: string
  actorId: string
  method: AccessUnlockMethod | 'bound-mobile' | null
  failedAttempts: number | null
}

export interface AccessSecurityState {
  failedSecretAttempts: number
  lockedAt: string | null
  nextEventSequence: number
  events: AccessSecurityEvent[]
}

export interface SimulatorSession {
  operatorId: string
  workstationCode: string
  signedInAt: string
  platformTestDuty: PlatformTestDutySession | null
}

export interface PlatformTestDutySession {
  enabledAt: string
  expiresAt: string
  enabledBy: string
}

export interface SimulatorState {
  schemaVersion: 8
  operator: DemoOperator
  operators: DemoOperator[]
  institutions: AccessInstitution[]
  roles: AccessRole[]
  roleAssignments: AccessRoleAssignment[]
  personnelRequests: PersonnelRequest[]
  attendanceRecords: AttendanceRecord[]
  accessAuditEvents: AccessAuditEvent[]
  nextPersonnelRequestSequence: number
  nextAttendanceSequence: number
  nextAccessAuditSequence: number
  security: AccessSecurityState
  securityByOperatorId: Record<string, AccessSecurityState>
  session: SimulatorSession | null
}
