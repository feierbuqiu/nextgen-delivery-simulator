import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import {
  hashSecret,
  normalizeWorkstationCode,
  secretMatches,
  validateSecret,
} from '../../domain/access/policy'
import {
  findOperatorByIdentifier,
  selectActiveOperator,
  synchronizeActiveIdentity,
} from '../../domain/access/authorization'
import {
  ACCESS_WARNING_FROM_ATTEMPT,
  clearSecretFailures,
  DEMO_RECOVERY_GRAPHICAL_CODE,
  DEMO_RECOVERY_SMS_CODE,
  recoverAccessSecret,
  registerSecretFailure,
  unlockWithSupervisorCredentials,
  validateRecoveryChallenge,
} from '../../domain/access/security'
import type { AccessRepository } from '../../domain/access/repository'
import {
  createSimulatorArchive,
  parseSimulatorArchive,
} from '../../domain/archive/simulatorArchive'
import {
  DEMO_BOUND_MOBILE,
  DEMO_ONE_TIME_CODE,
  DEMO_OPERATOR_ID,
  DEMO_TEMPORARY_SECRET,
} from '../../domain/access/seed'
import type {
  OperatorProfile,
  PersonnelType,
  SimulatorState,
} from '../../domain/access/types'
import { endPlatformTestDuty } from '../../domain/access/platformTestDuty'
import type { CustomerRepository } from '../../domain/customer/repository'
import type { ServiceRepository } from '../../domain/service/repository'
import { Modal } from '../../ui/Modal'
import { SimulatorShell } from '../shell/SimulatorShell'
import { OriginalNetworkIllustration } from './OriginalNetworkIllustration'

type Phase = 'loading' | 'access' | 'profile' | 'secret' | 'shell'

interface AccessExperienceProps {
  repository: AccessRepository
  customerRepository: CustomerRepository
  serviceRepository: ServiceRepository
}

interface ProfileFormState {
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
  reliefRoleIds: string[]
  jobInformation: string
  receiveSmsType: string
  receiveSmsTime: string
  responsibleStoreOutlet: string
  performanceSourceOutlet: string
  performanceEvaluation: string
}

const reliefRoleOptions = [
  { value: 'app-special-processing', label: 'APP 特殊处理' },
  { value: 'app-distribution-processing', label: 'APP 分发处理' },
  { value: 'app-finance-remittance', label: 'APP 业财缴款' },
  { value: 'container-management', label: '新容器管理' },
  { value: 'business-channel', label: '营业渠道' },
  { value: 'app-date-stamp-processing', label: 'APP 日戳处理' },
]

const jobRoleOptions = [
  { value: 'counter-operator', label: '营业员' },
  { value: 'integrated-clerk', label: '综合柜员' },
  { value: 'shift-supervisor', label: '营业班组长' },
  { value: 'operations-support', label: '运营支撑人员' },
]

const initialProfile: ProfileFormState = {
  displayName: '演示营业员',
  nameAbbreviation: 'YSYY',
  identityCode: '990101199001010011',
  gender: 'male',
  personnelStatus: 'active',
  birthDate: '1990-01-01',
  phone: DEMO_BOUND_MOBILE,
  institutionCode: '99901001',
  institutionName: '景麓营业部',
  employedDate: '2020-07-01',
  serviceYears: '6年1个月',
  arrivalDate: '2020-07-01',
  departureDate: '',
  mentalOutlook: 'good',
  personnelType: 'contract-a',
  workplaceRole: 'counter-service',
  jobCategory: 'service',
  directSupervisor: '90000001',
  educationLevel: 'college',
  professionalQualification: 'none',
  reliefPermission: 'disabled',
  reliefRoleIds: [],
  jobInformation: 'counter-operator',
  receiveSmsType: 'business-and-security',
  receiveSmsTime: '08:00-20:00',
  responsibleStoreOutlet: '景麓营业部',
  performanceSourceOutlet: '景麓营业部',
  performanceEvaluation: '良好',
}

function genderFromIdentityCode(identityCode: string): string | null {
  const normalized = identityCode.trim()
  if (!/^\d{17}[\dXx]$/.test(normalized)) return null
  return Number(normalized[16]) % 2 === 0 ? 'female' : 'male'
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
}

function isServiceYears(value: string): boolean {
  const match = /^(\d+)年(?:(\d{1,2})个月)?$/.exec(value.trim())
  if (!match) return false
  return match[2] === undefined || Number(match[2]) <= 11
}

function downloadArchive(source: string, exportedAt: string): void {
  const blob = new Blob([source], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `营业渠道模拟器备份-${exportedAt.slice(0, 19).replaceAll(':', '-')}.json`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function BrandMark() {
  return (
    <div className="brand-lockup">
      <span aria-hidden="true" className="brand-symbol">
        <span />
        <span />
        <span />
      </span>
      <div>
        <strong>寄递演练</strong>
        <small>LOCAL DELIVERY LAB</small>
      </div>
    </div>
  )
}

function VisualToken({
  compact = false,
  label = '扫码登录示意二维码',
}: {
  compact?: boolean
  label?: string
}) {
  const size = 21
  const cells = useMemo(
    () =>
      Array.from({ length: size * size }, (_, index) => {
        const row = Math.floor(index / size)
        const column = index % size
        const inFinder = (top: number, left: number) => {
          const localRow = row - top
          const localColumn = column - left
          if (localRow < 0 || localRow > 6 || localColumn < 0 || localColumn > 6) {
            return false
          }
          return localRow === 0 || localRow === 6 || localColumn === 0 || localColumn === 6 ||
            (localRow >= 2 && localRow <= 4 && localColumn >= 2 && localColumn <= 4)
        }
        if (inFinder(0, 0) || inFinder(0, 14) || inFinder(14, 0)) return true
        if ((row === 6 || column === 6) && row > 7 && column > 7) {
          return (row + column) % 2 === 0
        }
        return (row * 17 + column * 11 + row * column * 3 + 5) % 7 < 3
      }),
    [],
  )

  return (
    <svg
      aria-label={label}
      className={compact ? 'visual-token visual-token--compact' : 'visual-token'}
      role="img"
      viewBox={`0 0 ${size} ${size}`}
    >
      {cells.map((active, index) => (
        active ? (
          <rect
            fill="currentColor"
            height="1"
            key={index}
            width="1"
            x={index % size}
            y={Math.floor(index / size)}
          />
        ) : null
      ))}
    </svg>
  )
}

type AccessIconName = 'account' | 'secret' | 'workstation' | 'eye' | 'eye-off'

function AccessIcon({ name }: { name: AccessIconName }) {
  if (name === 'account') {
    return (
      <svg aria-hidden="true" className="access-field-icon" viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="3.4" />
        <path d="M5.5 19c.5-4 2.7-6 6.5-6s6 2 6.5 6" />
      </svg>
    )
  }
  if (name === 'secret') {
    return (
      <svg aria-hidden="true" className="access-field-icon" viewBox="0 0 24 24">
        <rect height="9" rx="1.5" width="12" x="6" y="11" />
        <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
        <path d="M12 14.5v2.5" />
      </svg>
    )
  }
  if (name === 'workstation') {
    return (
      <svg aria-hidden="true" className="access-field-icon" viewBox="0 0 24 24">
        <rect height="11" rx="1" width="16" x="4" y="4" />
        <path d="M9 20h6M12 15v5" />
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" className="access-visibility-icon" viewBox="0 0 24 24">
      <path d="M2.5 12s3.3-5 9.5-5 9.5 5 9.5 5-3.3 5-9.5 5-9.5-5-9.5-5Z" />
      <circle cx="12" cy="12" r="2.5" />
      {name === 'eye-off' ? <path d="m4 4 16 16" /> : null}
    </svg>
  )
}

export function AccessExperience({
  repository,
  customerRepository,
  serviceRepository,
}: AccessExperienceProps) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [state, setState] = useState<SimulatorState | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [identifier, setIdentifier] = useState(DEMO_OPERATOR_ID)
  const [credential, setCredential] = useState(DEMO_TEMPORARY_SECRET)
  const [workstation, setWorkstation] = useState('1')
  const [showCredential, setShowCredential] = useState(false)
  const [otpRequested, setOtpRequested] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [profileForm, setProfileForm] = useState<ProfileFormState>(initialProfile)
  const [currentSecret, setCurrentSecret] = useState('')
  const [newSecret, setNewSecret] = useState('')
  const [confirmSecret, setConfirmSecret] = useState('')
  const [profileError, setProfileError] = useState('')
  const [secretErrors, setSecretErrors] = useState<string[]>([])
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [recoveryStage, setRecoveryStage] = useState<'identity' | 'secret'>('identity')
  const [recoveryMobile, setRecoveryMobile] = useState('')
  const [recoveryGraphicalCode, setRecoveryGraphicalCode] = useState('')
  const [recoverySmsCode, setRecoverySmsCode] = useState('')
  const [recoverySmsIssued, setRecoverySmsIssued] = useState(false)
  const [recoveryNewSecret, setRecoveryNewSecret] = useState('')
  const [recoveryShowSecret, setRecoveryShowSecret] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')
  const [recoveryNotice, setRecoveryNotice] = useState('')
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [unlockSupervisorId, setUnlockSupervisorId] = useState('')
  const [unlockSupervisorSecret, setUnlockSupervisorSecret] = useState('')
  const [unlockShowSecret, setUnlockShowSecret] = useState(false)
  const [unlockError, setUnlockError] = useState('')

  useEffect(() => {
    let active = true
    const timeout = window.setTimeout(() => {
      if (!active) return
      setLoadError('本机演示数据响应超时。请关闭其他模拟器页面后重试，或恢复初始数据。')
    }, 8000)
    void repository.load()
      .then((loaded) => {
        if (!active) return
        window.clearTimeout(timeout)
        setState(loaded)
        if (loaded.security.lockedAt) {
          setError('您的账户已经被锁定，请联系主管。')
        }
        setPhase(loaded.session ? 'shell' : 'access')
      })
      .catch(() => {
        if (!active) return
        window.clearTimeout(timeout)
        setLoadError('本机演示数据未能读取。可先重试；若仍失败，可恢复初始数据。')
      })
    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [loadAttempt, repository])

  const usesOneTimeCode = /^\d{11}$/.test(identifier.trim())

  async function persist(next: SimulatorState): Promise<void> {
    const synchronized = synchronizeActiveIdentity(next)
    await repository.save(synchronized)
    setState(synchronized)
  }

  async function enterApplication(
    current: SimulatorState,
    normalizedWorkstation: string,
  ): Promise<void> {
    const now = new Date()
    const signedInAt = now.toISOString()
    const next: SimulatorState = {
      ...current,
      session: {
        operatorId: current.operator.id,
        workstationCode: normalizedWorkstation,
        signedInAt,
        platformTestDuty: null,
      },
    }
    await persist(next)
    setPhase('shell')
  }

  async function continueAfterCredential(
    current: SimulatorState,
    normalizedWorkstation: string,
  ): Promise<void> {
    if (!current.operator.profileCompleted) {
      setPhase('profile')
      return
    }
    if (current.operator.requiresSecretChange) {
      setPhase('secret')
      return
    }
    await enterApplication(current, normalizedWorkstation)
  }

  async function handleAccessSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!state) return
    setError('')
    setNotice('')
    const normalizedIdentifier = identifier.trim()
    const candidate = findOperatorByIdentifier(state, normalizedIdentifier)
    if (!candidate) {
      setError('演示账户不存在。')
      return
    }
    const selectedState = selectActiveOperator(state, candidate.id)
    if (selectedState.operator.accountStatus === 'disabled') {
      setError('该人员账户已经停用，请联系人员管理员。')
      return
    }
    if (selectedState.security.lockedAt) {
      setError('您的账户已经被锁定，请联系主管。')
      return
    }
    const normalizedWorkstation = normalizeWorkstationCode(workstation)
    if (selectedState.operator.requiresWorkstation && normalizedWorkstation === null) {
      setError('请输入 1 至 2 位数字台席号。')
      return
    }

    if (usesOneTimeCode) {
      if (!otpRequested || credential !== DEMO_ONE_TIME_CODE) {
        setError('请先获取并输入演示验证码。')
        return
      }
    } else {
      if (!(await secretMatches(credential, selectedState.operator.secretHash))) {
        const failed = registerSecretFailure(selectedState, new Date().toISOString())
        await persist(failed.state)
        if (failed.locked) {
          setError('您的账户已经被锁定，请联系主管。')
        } else if (failed.failedAttempts >= ACCESS_WARNING_FROM_ATTEMPT) {
          setError(`请输入正确的账户和密码，您还有${failed.remainingAttempts}次机会。`)
        } else {
          setError('账户或密码不正确。')
        }
        return
      }
    }

    const cleared = clearSecretFailures(selectedState)
    await persist(cleared)
    await continueAfterCredential(cleared, normalizedWorkstation ?? '01')
  }

  function openRecovery(): void {
    setRecoveryStage('identity')
    setRecoveryMobile('')
    setRecoveryGraphicalCode('')
    setRecoverySmsCode('')
    setRecoverySmsIssued(false)
    setRecoveryNewSecret('')
    setRecoveryShowSecret(false)
    setRecoveryError('')
    setRecoveryNotice('')
    setRecoveryOpen(true)
    setError('')
    setNotice('')
  }

  function closeRecovery(): void {
    setRecoveryOpen(false)
    setRecoveryError('')
    setRecoveryNotice('')
  }

  function requestRecoverySms(): void {
    if (!state) return
    try {
      validateRecoveryChallenge(state, {
        mobile: recoveryMobile,
        graphicalCode: recoveryGraphicalCode,
        smsCode: DEMO_RECOVERY_SMS_CODE,
        smsCodeIssued: true,
      })
      setRecoverySmsIssued(true)
      setRecoveryError('')
      setRecoveryNotice(`演示短信验证码：${DEMO_RECOVERY_SMS_CODE}`)
    } catch (caught) {
      setRecoveryError(caught instanceof Error ? caught.message : '身份校验失败。')
      setRecoveryNotice('')
    }
  }

  function handleRecoveryIdentitySubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!state) return
    try {
      validateRecoveryChallenge(state, {
        mobile: recoveryMobile,
        graphicalCode: recoveryGraphicalCode,
        smsCode: recoverySmsCode,
        smsCodeIssued: recoverySmsIssued,
      })
      setRecoveryStage('secret')
      setRecoveryError('')
      setRecoveryNotice('身份验证通过，请设置新密码。')
    } catch (caught) {
      setRecoveryError(caught instanceof Error ? caught.message : '身份校验失败。')
      setRecoveryNotice('')
    }
  }

  async function handleRecoverySecretSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!state) return
    try {
      const recovered = await recoverAccessSecret(state, {
        mobile: recoveryMobile,
        graphicalCode: recoveryGraphicalCode,
        smsCode: recoverySmsCode,
        smsCodeIssued: recoverySmsIssued,
        newSecret: recoveryNewSecret,
        recoveredAt: new Date().toISOString(),
      })
      await persist(recovered)
      setIdentifier(DEMO_OPERATOR_ID)
      setCredential('')
      closeRecovery()
      setNotice(state.security.lockedAt
        ? '密码重置成功，账户仍需主管授权解锁。'
        : '密码重置成功，请使用新密码重新登录。')
      setError('')
    } catch (caught) {
      setRecoveryError(caught instanceof Error ? caught.message : '密码重置失败。')
    }
  }

  function openUnlockAuthorization(): void {
    setUnlockSupervisorId('')
    setUnlockSupervisorSecret('')
    setUnlockShowSecret(false)
    setUnlockError('')
    setUnlockOpen(true)
    setNotice('')
  }

  function resetUnlockForm(): void {
    setUnlockSupervisorId('')
    setUnlockSupervisorSecret('')
    setUnlockError('')
  }

  async function finishUnlock(next: SimulatorState, message: string): Promise<void> {
    await persist(next)
    setUnlockOpen(false)
    resetUnlockForm()
    setCredential('')
    setError('')
    setNotice(message)
  }

  async function handleSupervisorUnlock(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!state) return
    try {
      const unlocked = unlockWithSupervisorCredentials(
        state,
        unlockSupervisorId,
        unlockSupervisorSecret,
        new Date().toISOString(),
      )
      await finishUnlock(unlocked, '主管授权成功，账户已解锁，请重新登录。')
    } catch (caught) {
      setUnlockError(caught instanceof Error ? caught.message : '主管授权失败。')
    }
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!state) return
    const missing = [
      profileForm.identityCode,
      profileForm.gender,
      profileForm.personnelStatus,
      profileForm.phone,
      profileForm.institutionCode,
      profileForm.employedDate,
      profileForm.arrivalDate,
      profileForm.mentalOutlook,
      profileForm.personnelType,
      profileForm.workplaceRole,
      profileForm.jobCategory,
      profileForm.educationLevel,
      profileForm.professionalQualification,
      profileForm.reliefPermission,
      profileForm.jobInformation,
    ].some((value) => value.trim() === '')
    const requiresReliefRole = profileForm.reliefPermission === 'enabled'
    if (missing || (requiresReliefRole && profileForm.reliefRoleIds.length === 0)) {
      setProfileError('信息不完整，请先完善所有必填项。')
      return
    }
    if (!/^\d{17}[\dXx]$/.test(profileForm.identityCode.trim())) {
      setProfileError('人员身份证须符合 18 位号码结构。')
      return
    }
    if (!/^1\d{10}$/.test(profileForm.phone.trim())) {
      setProfileError('手机号码须为 11 位号码。')
      return
    }
    const profileDates: Array<[string, string]> = [
      ['出生年月日', profileForm.birthDate],
      ['在岗日期', profileForm.employedDate],
      ['到岗日期', profileForm.arrivalDate],
      ['离岗日期', profileForm.departureDate],
    ]
    const invalidDate = profileDates.find(([, value]) => value !== '' && !isIsoDate(value))
    if (invalidDate) {
      setProfileError(`${invalidDate[0]}须使用有效的 YYYY-MM-DD 格式。`)
      return
    }
    if (profileForm.serviceYears && !isServiceYears(profileForm.serviceYears)) {
      setProfileError('人员工龄须使用“1年9个月”或“2年”格式。')
      return
    }

    const profile: OperatorProfile = {
      displayName: profileForm.displayName.trim(),
      nameAbbreviation: profileForm.nameAbbreviation.trim().toUpperCase(),
      identityCode: profileForm.identityCode.trim(),
      gender: profileForm.gender,
      personnelStatus: profileForm.personnelStatus,
      birthDate: profileForm.birthDate,
      phone: profileForm.phone.trim(),
      institutionCode: profileForm.institutionCode.trim(),
      institutionName: profileForm.institutionName.trim(),
      employedDate: profileForm.employedDate,
      serviceYears: profileForm.serviceYears.trim(),
      arrivalDate: profileForm.arrivalDate,
      departureDate: profileForm.departureDate,
      mentalOutlook: profileForm.mentalOutlook,
      personnelType: profileForm.personnelType,
      workplaceRole: profileForm.workplaceRole,
      jobCategory: profileForm.jobCategory,
      directSupervisor: profileForm.directSupervisor.trim(),
      educationLevel: profileForm.educationLevel,
      professionalQualification: profileForm.professionalQualification,
      reliefPermission: profileForm.reliefPermission,
      jobInformation: profileForm.jobInformation,
      reliefEligible: requiresReliefRole,
      reliefRoleIds: requiresReliefRole ? profileForm.reliefRoleIds : [],
      receiveSmsType: profileForm.receiveSmsType,
      receiveSmsTime: profileForm.receiveSmsTime.trim(),
      responsibleStoreOutlet: profileForm.responsibleStoreOutlet.trim(),
      performanceSourceOutlet: profileForm.performanceSourceOutlet.trim(),
      performanceEvaluation: profileForm.performanceEvaluation.trim(),
    }
    const next: SimulatorState = {
      ...state,
      operator: {
        ...state.operator,
        profile,
        profileCompleted: true,
      },
    }
    await persist(next)
    setProfileError('')
    if (next.operator.requiresSecretChange) {
      setPhase('secret')
    } else {
      setCredential('')
      setNotice('人员信息保存成功，请重新登录。')
      setPhase('access')
    }
  }

  async function handleSecretSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!state) return
    const errors: string[] = []
    if (!(await secretMatches(currentSecret, state.operator.secretHash))) {
      errors.push('原密码不正确')
    }
    const policy = validateSecret(newSecret)
    errors.push(...policy.violations)
    if (newSecret !== confirmSecret) {
      errors.push('两次输入的新密码不一致')
    }
    const nextSecretHash = await hashSecret(newSecret)
    const secretHistory = Array.from(new Set([
      ...(state.operator.secretHistoryHashes ?? []),
      state.operator.secretHash,
    ]))
    if (secretHistory.includes(nextSecretHash)) {
      errors.push('新密码不能与任何旧密码重复')
    }
    if (errors.length) {
      setSecretErrors(errors)
      return
    }

    const next: SimulatorState = {
      ...state,
      operator: {
        ...state.operator,
        secretHash: nextSecretHash,
        secretHistoryHashes: [...secretHistory, nextSecretHash],
        requiresSecretChange: false,
      },
      session: null,
    }
    await persist(next)
    setSecretErrors([])
    setCurrentSecret('')
    setNewSecret('')
    setConfirmSecret('')
    setCredential('')
    setNotice('密码修改成功，请使用新密码重新登录。')
    setPhase('access')
  }

  async function handleLogout(): Promise<void> {
    if (!state) return
    const ended = endPlatformTestDuty(state, 'logout', new Date().toISOString())
    const next = { ...ended, session: null }
    await persist(next)
    setCredential('')
    setNotice('已安全退出本地演示。')
    setPhase('access')
  }

  async function handleStartSecretChange(): Promise<void> {
    if (!state) return
    const ended = endPlatformTestDuty(state, 'session-ended', new Date().toISOString())
    await persist({ ...ended, session: null })
    setCurrentSecret('')
    setNewSecret('')
    setConfirmSecret('')
    setSecretErrors([])
    setPhase('secret')
  }

  async function handleSeedReset(): Promise<void> {
    const [seed] = await Promise.all([
      repository.reset(),
      customerRepository.reset(),
      serviceRepository.reset(),
    ])
    setState(seed)
    setIdentifier(DEMO_OPERATOR_ID)
    setCredential(DEMO_TEMPORARY_SECRET)
    setWorkstation('1')
    setProfileForm(initialProfile)
    setOtpRequested(false)
    setRecoveryOpen(false)
    setUnlockOpen(false)
    setError('')
    setNotice('演示种子已恢复。')
    setPhase('access')
  }

  async function handleStorageRecoveryReset(): Promise<void> {
    setLoadError('')
    try {
      await handleSeedReset()
    } catch {
      setLoadError('初始数据恢复失败。请关闭其他模拟器页面后重新加载。')
    }
  }

  async function handleArchiveExport(): Promise<void> {
    if (!state) throw new Error('登录数据尚未准备完成。')
    const [customers, services] = await Promise.all([
      customerRepository.load(),
      serviceRepository.load(),
    ])
    const archive = createSimulatorArchive(state, customers, services)
    downloadArchive(JSON.stringify(archive, null, 2), archive.exportedAt)
  }

  async function handleArchiveImport(file: File): Promise<void> {
    if (file.size > 16 * 1024 * 1024) {
      throw new Error('备份文件超过 16 MB，未执行恢复。')
    }
    const archive = parseSimulatorArchive(await file.text())
    const [previousCustomers, previousServices] = await Promise.all([
      customerRepository.load(),
      serviceRepository.load(),
    ])
    const previousAccess = state
    try {
      const [restoredAccess] = await Promise.all([
        repository.restore(archive.data.access),
        customerRepository.restore(archive.data.customers),
        serviceRepository.restore(archive.data.services),
      ])
      setState(restoredAccess)
      setError('')
      setNotice('')
      setPhase(restoredAccess.session ? 'shell' : 'access')
    } catch {
      if (previousAccess) {
        const rollbackResults = await Promise.allSettled([
          repository.restore(previousAccess),
          customerRepository.restore(previousCustomers),
          serviceRepository.restore(previousServices),
        ])
        if (rollbackResults.some((result) => result.status === 'rejected')) {
          throw new Error('备份恢复失败，且本机数据回滚不完整；请重新加载页面后检查。')
        }
      }
      throw new Error('备份恢复失败，原有本机数据已保留。')
    }
  }

  if (!state && loadError) {
    return (
      <main className="loading-screen">
        <section aria-labelledby="storage-recovery-title" className="loading-recovery-card">
          <h1 id="storage-recovery-title">本机数据加载异常</h1>
          <p role="alert">{loadError}</p>
          <div>
            <button
              className="primary-button primary-button--compact"
              onClick={() => {
                setLoadError('')
                setLoadAttempt((attempt) => attempt + 1)
              }}
              type="button"
            >
              重试加载
            </button>
            <button
              className="secondary-button"
              onClick={() => void handleStorageRecoveryReset()}
              type="button"
            >
              恢复初始数据
            </button>
          </div>
          <small>恢复初始数据会清除本浏览器内的模拟业务记录。</small>
        </section>
      </main>
    )
  }

  if (phase === 'loading' || !state) {
    return (
      <main className="loading-screen">
        <span className="loading-spinner" />
        <p>正在准备本地演示数据…</p>
      </main>
    )
  }

  if (phase === 'shell') {
    return (
      <SimulatorShell
        customerRepository={customerRepository}
        onAccessStateChange={persist}
        onChangeSecret={() => void handleStartSecretChange()}
        onExportArchive={handleArchiveExport}
        onImportArchive={handleArchiveImport}
        onLogout={handleLogout}
        onReset={handleSeedReset}
        state={state}
        serviceRepository={serviceRepository}
      />
    )
  }

  return (
    <main className="access-screen">
      <div aria-hidden="true" className="background-block background-block--left" />
      <div aria-hidden="true" className="background-block background-block--right" />
      <div className="access-header">
        <BrandMark />
        <div className="header-actions">
          <button className="header-reset" onClick={() => void handleSeedReset()} type="button">
            恢复种子
          </button>
        </div>
      </div>

      <section className="access-layout">
        <div className="hero-area">
          <OriginalNetworkIllustration />
        </div>

        <section className="access-card" aria-labelledby="access-title">
          <div className="access-card-heading">
            <h2 id="access-title">次世代寄递业务模拟器</h2>
            <p className="access-local-only-notice">
              非官方离线工具，仅限本机演练；禁止录入真实个人信息、业务号码、账号或凭据。
            </p>
          </div>

          <form className="access-form" onSubmit={(event) => void handleAccessSubmit(event)}>
            <label className="input-row">
              <span aria-hidden="true" className="input-icon"><AccessIcon name="account" /></span>
              <span className="sr-only">账户或演示手机号</span>
              <input
                autoComplete="username"
                onChange={(event) => {
                  setIdentifier(event.target.value)
                  setCredential('')
                  setOtpRequested(false)
                }}
                placeholder="请输入账户或演示手机号"
                value={identifier}
              />
            </label>

            <label className="input-row">
              <span aria-hidden="true" className="input-icon"><AccessIcon name="secret" /></span>
              <span className="sr-only">{usesOneTimeCode ? '验证码' : '密码'}</span>
              <input
                autoComplete={usesOneTimeCode ? 'one-time-code' : 'current-password'}
                onChange={(event) => setCredential(event.target.value)}
                placeholder={usesOneTimeCode ? '请输入演示验证码' : '请输入密码'}
                type={showCredential ? 'text' : 'password'}
                value={credential}
              />
              {usesOneTimeCode ? (
                <button
                  className="inline-action"
                  onClick={() => {
                    setOtpRequested(true)
                    setNotice(`演示验证码：${DEMO_ONE_TIME_CODE}`)
                    setError('')
                  }}
                  type="button"
                >
                  获取验证码
                </button>
              ) : (
                <button
                  aria-label={showCredential ? '隐藏密码' : '显示密码'}
                  className="visibility-button"
                  onClick={() => setShowCredential((visible) => !visible)}
                  type="button"
                >
                  <AccessIcon name={showCredential ? 'eye-off' : 'eye'} />
                </button>
              )}
            </label>

            <label className="input-row">
              <span aria-hidden="true" className="input-icon"><AccessIcon name="workstation" /></span>
              <span className="sr-only">坐席号</span>
              <input
                inputMode="numeric"
                maxLength={2}
                onChange={(event) => setWorkstation(event.target.value)}
                placeholder="请输入坐席号"
                value={workstation}
              />
            </label>

            {error ? <p className="form-message form-message--error" role="alert">{error}</p> : null}
            {notice ? <p className="form-message form-message--notice" role="status">{notice}</p> : null}

            <button className="primary-button" type="submit">登录</button>
            <span className="login-version">V0.0.10086</span>
            <nav className="access-links" aria-label="账户辅助操作">
              <button
                onClick={() => {
                  setIdentifier('')
                  setCredential('')
                  setWorkstation('')
                  setError('')
                  setNotice('输入内容已重置。')
                }}
                type="button"
              >
                重置
              </button>
              <button onClick={openRecovery} type="button">
                忘记密码
              </button>
              <button onClick={openUnlockAuthorization} type="button">
                解锁授权
              </button>
            </nav>
          </form>

          <div className="scan-login-panel">
            <div className="login-divider"><span>扫码登录</span></div>
            <VisualToken />
            <p>请使用移动终端扫码登录</p>
          </div>
        </section>
      </section>

      <footer className="access-footer">
        次世代寄递业务模拟器 2026 · 非官方离线工具
      </footer>

      {recoveryOpen ? (
        <Modal compact eyebrow="" title="忘记密码">
          {recoveryStage === 'identity' ? (
            <form className="modal-form access-security-form recovery-form" onSubmit={handleRecoveryIdentitySubmit}>
              <header className="access-security-heading">
                <strong>身份认证</strong>
                <small>Authentication</small>
              </header>
              <label>
                <span>绑定手机号</span>
                <input
                  inputMode="tel"
                  maxLength={11}
                  onChange={(event) => setRecoveryMobile(event.target.value)}
                  placeholder="请输入手机号"
                  value={recoveryMobile}
                />
              </label>
              <div className="recovery-code-row">
                <label>
                  <span>图形验证码</span>
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    onChange={(event) => setRecoveryGraphicalCode(event.target.value)}
                    placeholder="请输入图形验证码"
                    value={recoveryGraphicalCode}
                  />
                </label>
                <span aria-label="图形验证码" className="graphical-code">{DEMO_RECOVERY_GRAPHICAL_CODE}</span>
              </div>
              <div className="recovery-code-row">
                <label>
                  <span>短信验证码</span>
                  <input
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) => setRecoverySmsCode(event.target.value)}
                    placeholder="请输入短信验证码"
                    value={recoverySmsCode}
                  />
                </label>
                <button className="secondary-button recovery-code-button" onClick={requestRecoverySms} type="button">获取验证码</button>
              </div>
              {recoveryNotice ? <p className="modal-notice" role="status">{recoveryNotice}</p> : null}
              {recoveryError ? <p className="modal-error" role="alert">{recoveryError}</p> : null}
              <div className="modal-actions">
                <button className="primary-button primary-button--compact" type="submit">找回密码</button>
                <button className="secondary-button" onClick={closeRecovery} type="button">退出</button>
              </div>
            </form>
          ) : (
            <form className="modal-form access-security-form recovery-form" onSubmit={(event) => void handleRecoverySecretSubmit(event)}>
              <header className="access-security-heading">
                <strong>新密码设置</strong>
                <small>Change Password</small>
              </header>
              <label>
                <span>新密码</span>
                <span className="security-secret-field">
                  <input
                    aria-label="新密码"
                    autoComplete="new-password"
                    onChange={(event) => setRecoveryNewSecret(event.target.value)}
                    type={recoveryShowSecret ? 'text' : 'password'}
                    value={recoveryNewSecret}
                  />
                  <button
                    aria-label={recoveryShowSecret ? '隐藏找回密码' : '显示找回密码'}
                    onClick={() => setRecoveryShowSecret((visible) => !visible)}
                    type="button"
                  >
                    <AccessIcon name={recoveryShowSecret ? 'eye-off' : 'eye'} />
                  </button>
                </span>
              </label>
              <p className="policy-hint">密码应包含大写字母、小写字母、数字、特殊字符，长度 12 到 15 位，且不能与历史密码重复。</p>
              {recoveryNotice ? <p className="modal-notice" role="status">{recoveryNotice}</p> : null}
              {recoveryError ? <p className="modal-error" role="alert">{recoveryError}</p> : null}
              <div className="modal-actions">
                <button className="primary-button primary-button--compact" type="submit">确认提交</button>
                <button className="secondary-button" onClick={() => { setRecoveryStage('identity'); setRecoveryError('') }} type="button">返回</button>
              </div>
            </form>
          )}
        </Modal>
      ) : null}

      {unlockOpen ? (
        <Modal compact eyebrow="" title="解锁授权">
          <div className="modal-form access-security-form unlock-form">
            <form className="unlock-credential-form" onSubmit={(event) => void handleSupervisorUnlock(event)}>
              <label>
                <span>主管工号</span>
                <input aria-label="主管工号" onChange={(event) => setUnlockSupervisorId(event.target.value)} placeholder="请主管输入工号" value={unlockSupervisorId} />
              </label>
              <label>
                <span>主管密码</span>
                <span className="security-secret-field">
                  <input
                    aria-label="主管密码"
                    onChange={(event) => setUnlockSupervisorSecret(event.target.value)}
                    placeholder="请输入主管工号对应密码"
                    type={unlockShowSecret ? 'text' : 'password'}
                    value={unlockSupervisorSecret}
                  />
                  <button
                    aria-label={unlockShowSecret ? '隐藏主管密码' : '显示主管密码'}
                    onClick={() => setUnlockShowSecret((visible) => !visible)}
                    type="button"
                  ><AccessIcon name={unlockShowSecret ? 'eye-off' : 'eye'} /></button>
                </span>
              </label>
              <button className="fingerprint-placeholder" disabled type="button">使用指纹登录 ◎</button>
              <p className="policy-hint">主管工号和密码必须由主管本人现场输入，系统不显示、代填或模拟远程核准。</p>
              <div className="unlock-actions">
                <button className="secondary-button" onClick={resetUnlockForm} type="button">重置</button>
                <button className="primary-button primary-button--compact" type="submit">确认授权</button>
              </div>
            </form>
            {unlockError ? <p className="modal-error" role="alert">{unlockError}</p> : null}
            <div className="unlock-guidance">
              <span>仅支持主管本人在当前终端完成人工核准。</span>
              <span>授权主管包括直接主管、本机构支局管理人员和上级主管机构业务管理人员。</span>
            </div>
            <div className="modal-actions modal-actions--compact">
              <button className="secondary-button" onClick={() => setUnlockOpen(false)} type="button">退出</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {phase === 'profile' ? (
        <Modal
          eyebrow=""
          title="修改人员信息"
          wide
        >
          <form className="modal-form personnel-form" noValidate onSubmit={(event) => void handleProfileSubmit(event)}>
            <div className="profile-grid">
              <label>
                <span>人员姓名</span>
                <input
                  onChange={(event) => setProfileForm({ ...profileForm, displayName: event.target.value })}
                  value={profileForm.displayName}
                />
              </label>
              <label>
                <span>姓名简拼</span>
                <input
                  onChange={(event) => setProfileForm({ ...profileForm, nameAbbreviation: event.target.value })}
                  value={profileForm.nameAbbreviation}
                />
              </label>
              <label>
                <span><b>*</b> 人员身份证</span>
                <input
                  onChange={(event) => {
                    const identityCode = event.target.value
                    const inferredGender = genderFromIdentityCode(identityCode)
                    setProfileForm((current) => ({
                      ...current,
                      identityCode,
                      gender: inferredGender ?? current.gender,
                    }))
                  }}
                  value={profileForm.identityCode}
                />
              </label>
              <label>
                <span><b>*</b> 性别</span>
                <select
                  onChange={(event) => setProfileForm({ ...profileForm, gender: event.target.value })}
                  value={profileForm.gender}
                >
                  <option value="female">女</option>
                  <option value="male">男</option>
                  <option value="unspecified">未说明</option>
                </select>
              </label>
              <label>
                <span><b>*</b> 人员状态</span>
                <select
                  onChange={(event) => setProfileForm({ ...profileForm, personnelStatus: event.target.value })}
                  value={profileForm.personnelStatus}
                >
                  <option value="active">在岗</option>
                  <option value="seconded">借调</option>
                  <option value="leave">离岗</option>
                </select>
              </label>
              <label>
                <span><b>*</b> 人员类型</span>
                <select
                  onChange={(event) => setProfileForm({ ...profileForm, personnelType: event.target.value as PersonnelType })}
                  value={profileForm.personnelType}
                >
                  <option value="contract-a">合同工 A 类</option>
                  <option value="contract-b">合同工 B 类</option>
                  <option value="labor-employment">劳务用工</option>
                  <option value="labor-contracting">劳务承揽</option>
                  <option value="part-time">非全日制用工</option>
                  <option value="business-outsourcing">业务外包</option>
                  <option value="commissioned-services">委托办</option>
                </select>
              </label>
              <label>
                <span>出生年月日</span>
                <input
                  inputMode="numeric"
                  maxLength={10}
                  onChange={(event) => setProfileForm({ ...profileForm, birthDate: event.target.value })}
                  placeholder="YYYY-MM-DD"
                  value={profileForm.birthDate}
                />
              </label>
              <label>
                <span><b>*</b> 手机号码</span>
                <input
                  onChange={(event) => setProfileForm({ ...profileForm, phone: event.target.value })}
                  value={profileForm.phone}
                />
              </label>
              <label>
                <span><b>*</b> 机构编码</span>
                <input
                  onChange={(event) => setProfileForm({ ...profileForm, institutionCode: event.target.value })}
                  value={profileForm.institutionCode}
                />
              </label>
              <label>
                <span>机构名称</span>
                <input
                  onChange={(event) => setProfileForm({ ...profileForm, institutionName: event.target.value })}
                  value={profileForm.institutionName}
                />
              </label>
              <label>
                <span><b>*</b> 在岗日期</span>
                <input
                  inputMode="numeric"
                  maxLength={10}
                  onChange={(event) => setProfileForm({ ...profileForm, employedDate: event.target.value })}
                  placeholder="YYYY-MM-DD"
                  value={profileForm.employedDate}
                />
              </label>
              <label>
                <span>人员工龄</span>
                <input
                  onChange={(event) => setProfileForm({ ...profileForm, serviceYears: event.target.value })}
                  placeholder="如：1年9个月"
                  value={profileForm.serviceYears}
                />
              </label>
              <label>
                <span><b>*</b> 到岗日期</span>
                <input
                  inputMode="numeric"
                  maxLength={10}
                  onChange={(event) => setProfileForm({ ...profileForm, arrivalDate: event.target.value })}
                  placeholder="YYYY-MM-DD"
                  value={profileForm.arrivalDate}
                />
              </label>
              <label>
                <span>离岗日期</span>
                <input
                  inputMode="numeric"
                  maxLength={10}
                  onChange={(event) => setProfileForm({ ...profileForm, departureDate: event.target.value })}
                  placeholder="YYYY-MM-DD"
                  value={profileForm.departureDate}
                />
              </label>
              <label>
                <span><b>*</b> 精神面貌</span>
                <select
                  onChange={(event) => setProfileForm({ ...profileForm, mentalOutlook: event.target.value })}
                  value={profileForm.mentalOutlook}
                >
                  <option value="good">良好</option>
                  <option value="stable">稳定</option>
                  <option value="attention">需关注</option>
                </select>
              </label>
              <label>
                <span><b>*</b> 工作岗位</span>
                <select
                  onChange={(event) => setProfileForm({ ...profileForm, workplaceRole: event.target.value })}
                  value={profileForm.workplaceRole}
                >
                  <option value="counter-service">营业受理</option>
                  <option value="customer-service">客户服务</option>
                  <option value="operations">运营管理</option>
                </select>
              </label>
              <label>
                <span><b>*</b> 岗位类别</span>
                <select
                  onChange={(event) => setProfileForm({ ...profileForm, jobCategory: event.target.value })}
                  value={profileForm.jobCategory}
                >
                  <option value="service">营业服务</option>
                  <option value="management">经营管理</option>
                  <option value="support">业务支撑</option>
                </select>
              </label>
              <label>
                <span>直接主管</span>
                <select
                  onChange={(event) => setProfileForm({ ...profileForm, directSupervisor: event.target.value })}
                  value={profileForm.directSupervisor}
                >
                  <option value="90000001">演示主管</option>
                  <option value="91000001">演示人员管理员</option>
                </select>
              </label>
              <label>
                <span><b>*</b> 文化程度</span>
                <select
                  onChange={(event) => setProfileForm({ ...profileForm, educationLevel: event.target.value })}
                  value={profileForm.educationLevel}
                >
                  <option value="college">大专</option>
                  <option value="bachelor">本科</option>
                  <option value="postgraduate">研究生</option>
                  <option value="other">其他</option>
                </select>
              </label>
              <label>
                <span><b>*</b> 职业资格</span>
                <select
                  onChange={(event) => setProfileForm({ ...profileForm, professionalQualification: event.target.value })}
                  value={profileForm.professionalQualification}
                >
                  <option value="none">无</option>
                  <option value="postal-service">营业服务资格</option>
                  <option value="operations">业务运营资格</option>
                  <option value="trainee">见习资格</option>
                </select>
              </label>
              <label>
                <span><b>*</b> 替班权限</span>
                <select
                  onChange={(event) => setProfileForm({ ...profileForm, reliefPermission: event.target.value })}
                  value={profileForm.reliefPermission}
                >
                  <option value="disabled">不可替班</option>
                  <option value="enabled">可替班</option>
                </select>
              </label>
              {profileForm.reliefPermission === 'enabled' ? (
                <fieldset className="profile-grid-wide relief-role-field">
                  <legend><b>*</b> 替班岗位信息（可多选）</legend>
                  <div className="relief-role-options">
                    {reliefRoleOptions.map((option) => (
                      <label key={option.value}>
                        <input
                          checked={profileForm.reliefRoleIds.includes(option.value)}
                          onChange={(event) => setProfileForm((current) => ({
                            ...current,
                            reliefRoleIds: event.target.checked
                              ? [...current.reliefRoleIds, option.value]
                              : current.reliefRoleIds.filter((roleId) => roleId !== option.value),
                          }))}
                          type="checkbox"
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              <label>
                <span><b>*</b> 岗位信息</span>
                <select
                  onChange={(event) => setProfileForm({ ...profileForm, jobInformation: event.target.value })}
                  value={profileForm.jobInformation}
                >
                  {jobRoleOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>接收短信类型</span>
                <select
                  onChange={(event) => setProfileForm({ ...profileForm, receiveSmsType: event.target.value })}
                  value={profileForm.receiveSmsType}
                >
                  <option value="business-and-security">业务及安全提醒</option>
                  <option value="business">业务提醒</option>
                  <option value="security">安全提醒</option>
                  <option value="disabled">不接收</option>
                </select>
              </label>
              <label>
                <span>接收短信时间</span>
                <input
                  onChange={(event) => setProfileForm({ ...profileForm, receiveSmsTime: event.target.value })}
                  placeholder="如：08:00-20:00"
                  value={profileForm.receiveSmsTime}
                />
              </label>
              <label>
                <span>负责巡店网点</span>
                <input
                  onChange={(event) => setProfileForm({ ...profileForm, responsibleStoreOutlet: event.target.value })}
                  value={profileForm.responsibleStoreOutlet}
                />
              </label>
              <label>
                <span>业绩来源网点</span>
                <input
                  onChange={(event) => setProfileForm({ ...profileForm, performanceSourceOutlet: event.target.value })}
                  value={profileForm.performanceSourceOutlet}
                />
              </label>
              <label>
                <span>业绩评价</span>
                <input
                  onChange={(event) => setProfileForm({ ...profileForm, performanceEvaluation: event.target.value })}
                  value={profileForm.performanceEvaluation}
                />
              </label>
            </div>
            <div aria-label="员工扩展信息预留" className="profile-placeholder-grid">
              <button disabled type="button">
                <span>兼职岗位信息维护</span>
                <small>预留</small>
              </button>
              <button disabled type="button">
                <span>人员标签采集</span>
                <small>预留</small>
              </button>
            </div>
            {profileError ? <p className="modal-error" role="alert">{profileError}</p> : null}
            <div className="modal-actions">
              <button className="primary-button primary-button--compact" type="submit">确定</button>
              <button className="secondary-button" onClick={() => setPhase('access')} type="button">取消</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {phase === 'secret' ? (
        <Modal
          description="密码须符合安全规则，保存后需要重新登录。"
          title="人员密码修改"
        >
          <form className="modal-form secret-form" onSubmit={(event) => void handleSecretSubmit(event)}>
            <label>
              <span>原密码</span>
              <input
                autoComplete="current-password"
                onChange={(event) => setCurrentSecret(event.target.value)}
                type={showCredential ? 'text' : 'password'}
                value={currentSecret}
              />
            </label>
            <label>
              <span>新密码</span>
              <input
                autoComplete="new-password"
                onChange={(event) => setNewSecret(event.target.value)}
                type={showCredential ? 'text' : 'password'}
                value={newSecret}
              />
            </label>
            <label>
              <span>确认新密码</span>
              <input
                autoComplete="new-password"
                onChange={(event) => setConfirmSecret(event.target.value)}
                type={showCredential ? 'text' : 'password'}
                value={confirmSecret}
              />
            </label>
            <button className="visibility-link" onClick={() => setShowCredential((visible) => !visible)} type="button">
              {showCredential ? '隐藏密码' : '显示密码'}
            </button>
            <p className="policy-hint">12-15 位，且同时包含大写字母、小写字母、数字和特殊字符。</p>
            {secretErrors.length ? (
              <div className="modal-error" role="alert">
                <strong>密码校验未通过：</strong>
                <ul>{secretErrors.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            ) : null}
            <div className="modal-actions">
              <button className="primary-button primary-button--compact" type="submit">确定</button>
              <button className="secondary-button" onClick={() => setPhase('access')} type="button">取消</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </main>
  )
}
