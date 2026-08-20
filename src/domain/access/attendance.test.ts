import { describe, expect, it } from 'vitest'

import { selectActiveOperator } from './authorization'
import {
  authorizeAttendanceAction,
  cancelEmployeeSignOut,
  cancelInstitutionSignOut,
  localWorkDate,
  projectEmployeeDuty,
  projectInstitutionAttendance,
  signInEmployee,
  signInInstitution,
  signOutEmployee,
  signOutInstitution,
} from './attendance'
import {
  DEMO_MANAGEMENT_SECRET,
  DEMO_TEMPORARY_SECRET,
  createSeedState,
} from './seed'
import type { SimulatorState } from './types'

function loggedIn(state: SimulatorState, occurredAt = '2026-08-12T01:00:00.000Z'): SimulatorState {
  return {
    ...state,
    session: {
      operatorId: state.operator.id,
      workstationCode: '01',
      signedInAt: occurredAt,
      platformTestDuty: null,
    },
  }
}

describe('access attendance', () => {
  it('requires manual institution and employee sign-in while allowing real off-hours work', async () => {
    const seed = await createSeedState()
    const manager = loggedIn(
      selectActiveOperator(seed, '90000001'),
      '2026-08-16T16:05:00.000Z',
    )
    const managerAuthorization = await authorizeAttendanceAction(
      manager,
      DEMO_MANAGEMENT_SECRET,
    )

    expect(localWorkDate(new Date('2026-08-11T17:00:00.000Z'))).toBe('2026-08-12')
    expect(projectInstitutionAttendance(
      manager,
      '99901001',
      '2026-08-17',
      '2026-08-16T16:05:00.000Z',
    ).status).toBe('not-signed-in')
    expect(() => signInInstitution(
      manager,
      '99901001',
      '2026-08-17',
      '90000001',
      '2026-08-16T16:05:00.000Z',
      {} as never,
    )).toThrow('重新验证密码后手工确认')
    expect(() => signInEmployee(
      manager,
      '2026-08-16T16:05:00.000Z',
      '2026-08-17',
      '01',
      managerAuthorization,
    )).toThrow('机构人工签到')

    const institutionOpened = signInInstitution(
      manager,
      '99901001',
      '2026-08-17',
      '90000001',
      '2026-08-16T16:05:00.000Z',
      managerAuthorization,
    )
    expect(projectInstitutionAttendance(
      institutionOpened,
      '99901001',
      '2026-08-17',
      '2026-08-16T16:06:00.000Z',
    )).toMatchObject({ status: 'signed-in', activePeriod: { label: '本次营业' } })
    expect(() => signInEmployee(
      institutionOpened,
      '2026-08-16T16:06:00.000Z',
      '2026-08-17',
      '01',
      managerAuthorization,
    )).toThrow('必须由不同工号分别手工确认')

    const employee = loggedIn(
      selectActiveOperator(institutionOpened, '80000001'),
      '2026-08-16T16:10:00.000Z',
    )
    const employeeAuthorization = await authorizeAttendanceAction(
      employee,
      DEMO_TEMPORARY_SECRET,
    )
    expect(employee.attendanceRecords).toHaveLength(0)
    const attended = signInEmployee(
      employee,
      '2026-08-16T16:10:00.000Z',
      '2026-08-17',
      '01',
      employeeAuthorization,
    )
    expect(attended.attendanceRecords).toHaveLength(1)
    expect(attended.attendanceRecords[0]).toMatchObject({
      institutionSignedInAt: '2026-08-16T16:05:00.000Z',
      institutionSignedInBy: '90000001',
      employeeSignedInAt: '2026-08-16T16:10:00.000Z',
      employeeSignedOutAt: null,
    })
    expect(attended.accessAuditEvents.map((event) => event.action)).toEqual([
      'institution-signed-in',
      'employee-signed-in',
    ])
    expect(projectEmployeeDuty(
      attended,
      '2026-08-16T23:59:00.000Z',
    )).toMatchObject({ status: 'on-duty' })
    expect(() => signInEmployee(
      attended,
      '2026-08-16T16:15:00.000Z',
      '2026-08-17',
      '01',
      employeeAuthorization,
    )).toThrow('当前员工已经签到')
  })

  it('supports employee sign-out plus supervisor institution sign-out and cancellation', async () => {
    const seed = await createSeedState()
    const manager = loggedIn(selectActiveOperator(seed, '90000001'))
    const managerAuthorization = await authorizeAttendanceAction(
      manager,
      DEMO_MANAGEMENT_SECRET,
    )
    const institutionOpened = signInInstitution(
      manager,
      '99901001',
      '2026-08-12',
      '90000001',
      '2026-08-12T01:00:00.000Z',
      managerAuthorization,
    )
    const employee = loggedIn(selectActiveOperator(institutionOpened, '80000001'))
    const employeeAuthorization = await authorizeAttendanceAction(
      employee,
      DEMO_TEMPORARY_SECRET,
    )
    const attended = signInEmployee(
      employee,
      '2026-08-12T01:05:00.000Z',
      '2026-08-12',
      '01',
      employeeAuthorization,
    )
    const recordId = attended.attendanceRecords[0]!.id
    const signedOut = signOutEmployee(
      attended,
      recordId,
      '80000001',
      '2026-08-12T02:00:00.000Z',
      employeeAuthorization,
    )
    expect(signedOut.attendanceRecords[0]?.employeeSignedOutAt)
      .toBe('2026-08-12T02:00:00.000Z')
    expect(projectEmployeeDuty(
      signedOut,
      '2026-08-12T02:01:00.000Z',
    )).toMatchObject({ status: 'signed-out' })
    const cancelled = cancelEmployeeSignOut(
      signedOut,
      recordId,
      '80000001',
      '2026-08-12T02:05:00.000Z',
      employeeAuthorization,
    )
    expect(cancelled.attendanceRecords[0]?.employeeSignedOutAt).toBeNull()
    expect(() => signOutInstitution(
      cancelled,
      '99901001',
      '2026-08-12',
      '80000001',
      '2026-08-12T02:10:00.000Z',
      employeeAuthorization,
    )).toThrow('没有机构签到签退操作权限')

    const management = loggedIn(selectActiveOperator(cancelled, '90000001'))
    const institutionSignedOut = signOutInstitution(
      management,
      '99901001',
      '2026-08-12',
      '90000001',
      '2026-08-12T02:10:00.000Z',
      managerAuthorization,
    )
    expect(projectInstitutionAttendance(
      institutionSignedOut,
      '99901001',
      '2026-08-12',
      '2026-08-12T02:11:00.000Z',
    )).toMatchObject({ status: 'signed-out', hasSupervisorSignOut: true })
    const institutionCancelled = cancelInstitutionSignOut(
      institutionSignedOut,
      '99901001',
      '2026-08-12',
      '90000001',
      '2026-08-12T02:12:00.000Z',
      managerAuthorization,
    )
    expect(projectInstitutionAttendance(
      institutionCancelled,
      '99901001',
      '2026-08-12',
      '2026-08-12T02:13:00.000Z',
    )).toMatchObject({ status: 'signed-in', hasSupervisorSignOut: false })
    expect(() => signOutInstitution(
      management,
      '99901000',
      '2026-08-12',
      '90000001',
      '2026-08-12T02:14:00.000Z',
      managerAuthorization,
    )).toThrow('没有机构签到签退操作权限')
  })

  it('keeps a manually opened duty cycle active across East-8 midnight', async () => {
    const seed = await createSeedState()
    const manager = loggedIn(
      selectActiveOperator(seed, '90000001'),
      '2026-08-17T15:50:00.000Z',
    )
    const managerAuthorization = await authorizeAttendanceAction(
      manager,
      DEMO_MANAGEMENT_SECRET,
    )
    const institutionOpened = signInInstitution(
      manager,
      '99901001',
      '2026-08-17',
      '90000001',
      '2026-08-17T15:50:00.000Z',
      managerAuthorization,
    )
    const employee = loggedIn(
      selectActiveOperator(institutionOpened, '80000001'),
      '2026-08-17T15:55:00.000Z',
    )
    const employeeAuthorization = await authorizeAttendanceAction(
      employee,
      DEMO_TEMPORARY_SECRET,
    )
    const attended = signInEmployee(
      employee,
      '2026-08-17T15:55:00.000Z',
      '2026-08-17',
      '01',
      employeeAuthorization,
    )

    expect(projectInstitutionAttendance(
      attended,
      '99901001',
      '2026-08-18',
      '2026-08-17T16:01:00.000Z',
    )).toMatchObject({ status: 'signed-in' })
    expect(projectEmployeeDuty(
      attended,
      '2026-08-17T16:01:00.000Z',
    )).toMatchObject({ status: 'on-duty', attendance: { workDate: '2026-08-17' } })

    const employeeSignedOut = signOutEmployee(
      attended,
      attended.attendanceRecords[0]!.id,
      '80000001',
      '2026-08-17T16:02:00.000Z',
      employeeAuthorization,
    )
    const management = loggedIn(
      selectActiveOperator(employeeSignedOut, '90000001'),
      '2026-08-17T16:03:00.000Z',
    )
    const afterMidnightAuthorization = await authorizeAttendanceAction(
      management,
      DEMO_MANAGEMENT_SECRET,
    )
    const institutionSignedOut = signOutInstitution(
      management,
      '99901001',
      '2026-08-18',
      '90000001',
      '2026-08-17T16:04:00.000Z',
      afterMidnightAuthorization,
    )
    expect(institutionSignedOut.attendanceRecords[0]).toMatchObject({
      institutionSignedOutAt: '2026-08-17T16:04:00.000Z',
    })
  })
})
