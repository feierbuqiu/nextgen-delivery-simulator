import type { ServiceOperatorSnapshot } from './types'

export const DEFAULT_SERVICE_INSTITUTION_CODE = '99901001'

export function serviceOperatorInstitutionCode(
  operator: ServiceOperatorSnapshot,
): string {
  return operator.institutionCode?.trim() || DEFAULT_SERVICE_INSTITUTION_CODE
}

export function assertServiceOperatorInstitution(
  operator: ServiceOperatorSnapshot,
  institutionCode: string,
): string {
  const expected = institutionCode.trim()
  if (!expected || serviceOperatorInstitutionCode(operator) !== expected) {
    throw new Error('当前记录不属于经办人员所在机构。')
  }
  return expected
}
