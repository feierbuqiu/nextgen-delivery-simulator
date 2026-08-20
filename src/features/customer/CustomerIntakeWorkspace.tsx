import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'

import {
  resolvePostalCode,
  searchAgreementAccounts,
  searchCustomerHistory,
  validateRecipient,
  validateSender,
  type CustomerErrors,
} from '../../domain/customer/policy'
import type { CustomerRepository } from '../../domain/customer/repository'
import {
  createEmptyRecipient,
  createEmptySender,
  FICTIONAL_ADDRESSES,
} from '../../domain/customer/seed'
import {
  ADDRESS_PICKER_PROVINCES,
  ADMINISTRATIVE_DIVISIONS,
  PREFECTURE_DIVISIONS,
} from '../../domain/customer/administrativeDivisions'
import type {
  AgreementAccount,
  CustomerDraft,
  CustomerHistoryRecord,
  CustomerWorkspaceState,
  DestinationRegion,
  FictionalAddress,
  ProductFamily,
  RecipientProfile,
  SenderProfile,
} from '../../domain/customer/types'
import {
  INTERNATIONAL_DESTINATIONS,
  type InternationalDestination,
} from '../../domain/service/international'
import type { ServiceRecommendationTransfer } from '../../domain/service/recommendation'
import type { AppointmentOrder } from '../../domain/service/appointmentCollection'
import { formatCents } from '../../domain/service/policy'
import type { ServiceRepository } from '../../domain/service/repository'
import type { ServiceDestinationZone } from '../../domain/service/types'
import { Modal } from '../../ui/Modal'
import {
  PostalSuppliesWorkspace,
} from '../service/PostalSuppliesWorkspace'
import { ChannelProductSalesWorkspace } from '../service/ChannelProductSalesWorkspace'
import { SupplementaryTrafficWorkspace } from '../service/SupplementaryTrafficWorkspace'
import { ElectronicCommerceWorkspace } from '../service/ElectronicCommerceWorkspace'
import {
  ServiceIntakePanel,
  type RecipientSectionContext,
  type ServiceSummary,
} from '../service/ServiceIntakePanel'

type Overlay =
  | 'sender'
  | 'agreement'
  | 'sender-history'
  | 'recipient-history'
  | null
type AddressTarget = 'sender' | 'recipient'
type AddressPickerTab = 'overseas' | 'province' | 'city' | 'district'
type ActiveServiceTab =
  | ProductFamily
  | 'postal-supplies'
  | 'channel-products'
  | 'supplementary-traffic'
  | 'electronic-commerce'

interface CustomerIntakeWorkspaceProps {
  repository: CustomerRepository
  serviceRepository: ServiceRepository
  initialRecommendation?: ServiceRecommendationTransfer | null
  initialServiceTab?: ActiveServiceTab
  onBack: () => void
  onOpenSettlement: () => void
  onServiceSummaryChange?: (summary: ServiceSummary) => void
}

const knownPostalCodes = FICTIONAL_ADDRESSES.map((address) => address.postalCode)
const divisionBodyByFullName = new Map<string, string>(
  ADMINISTRATIVE_DIVISIONS.map((division) => [division.fullName, division.body]),
)

function shortDivisionName(fullName: string): string {
  return divisionBodyByFullName.get(fullName) ?? fullName
}

const serviceFamilyTabs: Array<{
  label: string
  tab?: ActiveServiceTab
}> = [
  { label: '平函', tab: 'basic-letter' },
  { label: '挂函', tab: 'standard-delivery' },
  { label: '包裹', tab: 'parcel' },
  { label: '特快', tab: 'express' },
  { label: '用邮物品', tab: 'postal-supplies' },
  { label: '商品销售', tab: 'channel-products' },
  { label: '补录/交管', tab: 'supplementary-traffic' },
  { label: '电子商务', tab: 'electronic-commerce' },
]

interface DerivedDestination {
  zone: ServiceDestinationZone
  office: string
  administrativePrefix: string
}

function administrativePrefix(address: FictionalAddress): string {
  return address.hierarchy
    .filter((part, index, hierarchy) => part && part !== hierarchy[index - 1])
    .join('')
}

function destinationRegionForZone(
  zone: ServiceDestinationZone,
): DestinationRegion {
  return zone === 'local' || zone === 'nonlocal' ? 'domestic' : 'overseas'
}

function inferDestination(
  profile: RecipientProfile,
): DerivedDestination {
  if (!profile.detailedAddress.trim() && !profile.postalCode.trim()) {
    return { zone: '', office: '', administrativePrefix: '' }
  }

  const detailedAddress = profile.detailedAddress.trim()
  const matchedAddress = FICTIONAL_ADDRESSES.find((address) => {
    const prefix = administrativePrefix(address)
    return (
      (profile.postalCode.trim() && address.postalCode === profile.postalCode.trim()) ||
      (detailedAddress && prefix && detailedAddress.startsWith(prefix))
    )
  })
  if (matchedAddress) {
    return {
      zone: matchedAddress.zone,
      office: matchedAddress.destinationOffice ?? '',
      administrativePrefix: administrativePrefix(matchedAddress),
    }
  }

  const matchedDestination = INTERNATIONAL_DESTINATIONS.find(
    (destination) => profile.detailedAddress.trim() === destination.label,
  )
  if (matchedDestination) {
    return {
      zone: 'international',
      office: matchedDestination.code,
      administrativePrefix: matchedDestination.label,
    }
  }

  return { zone: '', office: '', administrativePrefix: '' }
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <span className="customer-field-error">{message}</span>
}

function HistoryTable({
  records,
  onSelect,
}: {
  records: CustomerHistoryRecord[]
  onSelect: (record: CustomerHistoryRecord) => void
}) {
  return (
    <div className="customer-table-wrap">
      <table className="customer-table">
        <thead>
          <tr>
            <th>序号</th>
            <th>联系电话</th>
            <th>姓名</th>
            <th>详细地址</th>
            <th>单位</th>
            <th>邮编</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record, index) => (
            <tr key={record.id}>
              <td>{index + 1}</td>
              <td>{record.contact || '—'}</td>
              <td>{record.name || '—'}</td>
              <td>{record.detailedAddress || '—'}</td>
              <td>{record.unit || '—'}</td>
              <td>{record.postalCode || '—'}</td>
              <td>
                <button
                  className="table-action"
                  onClick={() => onSelect(record)}
                  type="button"
                >
                  选择
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CustomerIntakeWorkspace({
  repository,
  serviceRepository,
  initialRecommendation = null,
  initialServiceTab,
  onBack,
  onOpenSettlement,
  onServiceSummaryChange,
}: CustomerIntakeWorkspaceProps) {
  const [workspace, setWorkspace] = useState<CustomerWorkspaceState | null>(null)
  const [productFamily, setProductFamily] =
    useState<ProductFamily>('basic-letter')
  const [activeServiceTab, setActiveServiceTab] =
    useState<ActiveServiceTab>(initialServiceTab ?? 'basic-letter')
  const [destinationRegion, setDestinationRegion] =
    useState<DestinationRegion>('domestic')
  const [destinationZone, setDestinationZone] =
    useState<ServiceDestinationZone>('')
  const [destinationOffice, setDestinationOffice] = useState('')
  const [sender, setSender] = useState<SenderProfile>(createEmptySender)
  const [recipient, setRecipient] =
    useState<RecipientProfile>(createEmptyRecipient)
  const [senderErrors, setSenderErrors] = useState<CustomerErrors>({})
  const [recipientErrors, setRecipientErrors] = useState<CustomerErrors>({})
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [agreementQuery, setAgreementQuery] = useState('')
  const [historyResults, setHistoryResults] = useState<CustomerHistoryRecord[]>([])
  const [addressPickerTarget, setAddressPickerTarget] =
    useState<AddressTarget | null>(null)
  const [addressTab, setAddressTab] = useState<AddressPickerTab>('province')
  const [addressProvince, setAddressProvince] = useState('')
  const [addressCity, setAddressCity] = useState('')
  const [overseasQuery, setOverseasQuery] = useState('')
  const [recipientAdministrativePrefix, setRecipientAdministrativePrefix] =
    useState('')
  const senderAddressControlRef = useRef<HTMLDivElement>(null)
  const recipientAddressControlRef = useRef<HTMLDivElement>(null)
  const senderAddressInputRef = useRef<HTMLInputElement>(null)
  const recipientAddressInputRef = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState('')
  const [serviceSummary, setServiceSummary] = useState<ServiceSummary>({
    count: 0,
    totalCents: 0,
  })
  const [appointmentMailLocked, setAppointmentMailLocked] = useState(false)

  const handleServiceSummary = useCallback((summary: ServiceSummary) => {
    setServiceSummary(summary)
    onServiceSummaryChange?.(summary)
  }, [onServiceSummaryChange])

  const handleAppointmentLockChange = useCallback((locked: boolean) => {
    setAppointmentMailLocked(locked)
  }, [])

  const loadAppointmentCustomer = useCallback(async (order: AppointmentOrder) => {
    const next = await repository.saveDraft(order.customer)
    const inferredDestination = inferDestination(order.customer.recipient)
    setWorkspace(next)
    setProductFamily(order.customer.productFamily)
    setActiveServiceTab(order.customer.productFamily)
    setDestinationRegion(order.customer.destinationRegion)
    setDestinationZone(order.draft.destinationZone)
    setDestinationOffice(order.draft.destinationOffice)
    setRecipientAdministrativePrefix(inferredDestination.administrativePrefix)
    setSender(structuredClone(order.customer.sender))
    setRecipient(structuredClone(order.customer.recipient))
    setSenderErrors({})
    setRecipientErrors({})
    setAppointmentMailLocked(Boolean(order.draft.appointment?.mailInformationLocked))
    setNotice(`预约单 ${order.orderNumber} 的寄收件资料已带入。`)
  }, [repository])

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      setWorkspace(loaded)
      if (loaded.draft) {
        const inferredDestination = inferDestination(loaded.draft.recipient)
        const nextProductFamily = initialRecommendation?.productFamily ?? loaded.draft.productFamily
        setProductFamily(nextProductFamily)
        setActiveServiceTab(
          initialRecommendation?.productFamily ?? initialServiceTab ?? nextProductFamily,
        )
        setDestinationRegion(
          initialRecommendation
            ? destinationRegionForZone(initialRecommendation.destinationZone)
            : inferredDestination.zone
            ? destinationRegionForZone(inferredDestination.zone)
            : loaded.draft.destinationRegion,
        )
        setDestinationZone(initialRecommendation?.destinationZone ?? inferredDestination.zone)
        setDestinationOffice(initialRecommendation?.destinationOffice ?? inferredDestination.office)
        setRecipientAdministrativePrefix(inferredDestination.administrativePrefix)
        setSender(loaded.draft.sender)
        setRecipient(loaded.draft.recipient)
      } else {
        if (initialRecommendation) {
          setProductFamily(initialRecommendation.productFamily)
          setActiveServiceTab(initialRecommendation.productFamily)
          setDestinationRegion(destinationRegionForZone(initialRecommendation.destinationZone))
          setDestinationZone(initialRecommendation.destinationZone)
          setDestinationOffice(initialRecommendation.destinationOffice)
        } else {
          setActiveServiceTab(initialServiceTab ?? 'basic-letter')
        }
        setOverlay('sender')
      }
    })
    return () => {
      active = false
    }
  }, [initialRecommendation, initialServiceTab, repository])

  useEffect(() => {
    if (!addressPickerTarget) return
    const handlePointerDown = (event: PointerEvent) => {
      const control = addressPickerTarget === 'sender'
        ? senderAddressControlRef.current
        : recipientAddressControlRef.current
      if (!control?.contains(event.target as Node)) setAddressPickerTarget(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [addressPickerTarget])

  const agreementResults = useMemo(
    () =>
      searchAgreementAccounts(workspace?.agreementAccounts ?? [], agreementQuery),
    [agreementQuery, workspace?.agreementAccounts],
  )
  const domesticAddressOptions = useMemo(
    () => FICTIONAL_ADDRESSES.filter((address) => address.mode === 'domestic'),
    [],
  )
  const addressProvinces = ADDRESS_PICKER_PROVINCES
  const addressCities = useMemo(() => {
    const province = ADDRESS_PICKER_PROVINCES.find(
      (candidate) => candidate.fullName === addressProvince,
    )
    if (!province) return []
    const prefectures = PREFECTURE_DIVISIONS
      .filter((candidate) => candidate.parentId === province.id)
    return prefectures.length > 0 ? prefectures : [province]
  }, [addressProvince])
  const addressDistricts = useMemo(
    () => domesticAddressOptions.filter(
      (address) =>
        address.hierarchy[0] === addressProvince &&
        address.hierarchy[1] === addressCity,
    ),
    [addressCity, addressProvince, domesticAddressOptions],
  )
  const overseasDestinations = useMemo(() => {
    const query = overseasQuery.trim().toUpperCase()
    if (!query) return INTERNATIONAL_DESTINATIONS
    return INTERNATIONAL_DESTINATIONS.filter(
      (destination) =>
        destination.code.includes(query) || destination.label.includes(overseasQuery.trim()),
    )
  }, [overseasQuery])

  const identityRequired = productFamily !== 'basic-letter'
  const draftReady = workspace?.draft?.status === 'customer-ready'

  function normalizedPostal(value: string): string | null {
    if (!value.trim()) return ''
    return resolvePostalCode(value, knownPostalCodes)
  }

  async function saveSender(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!workspace) return
    const postalCode = normalizedPostal(sender.postalCode)
    if (postalCode === null) {
      setSenderErrors({ postalCode: '邮编前缀未匹配到地址，请输入六位数字。' })
      return
    }
    const normalizedSender = { ...sender, postalCode }
    const validation = validateSender(normalizedSender, identityRequired)
    if (!validation.valid) {
      setSenderErrors(validation.errors)
      return
    }
    const draft: CustomerDraft = {
      productFamily,
      destinationRegion,
      sender: normalizedSender,
      recipient,
      status: workspace.draft?.status ?? 'sender-ready',
      updatedAt: new Date().toISOString(),
    }
    const next = await repository.saveDraft(draft)
    setWorkspace(next)
    setSender(normalizedSender)
    setSenderErrors({})
    setNotice('寄件资料已保存为待办理草稿。')
    setOverlay(null)
  }

  async function saveRecipient(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault()
    if (!workspace?.draft) return
    const postalCode = normalizedPostal(recipient.postalCode)
    if (postalCode === null) {
      setRecipientErrors({ postalCode: '邮编前缀未匹配到地址，请输入六位数字。' })
      return
    }
    const normalizedRecipient = { ...recipient, postalCode }
    const validation = validateRecipient(normalizedRecipient)
    if (!validation.valid) {
      setRecipientErrors(validation.errors)
      return
    }
    const draft: CustomerDraft = {
      productFamily,
      destinationRegion,
      sender,
      recipient: normalizedRecipient,
      status: 'customer-ready',
      updatedAt: new Date().toISOString(),
    }
    const next = await repository.saveDraft(draft)
    setWorkspace(next)
    setRecipient(normalizedRecipient)
    setRecipientErrors({})
    setNotice('客户草稿已就绪，可进入下一阶段的业务受理。')
  }

  function openSenderHistory(): void {
    if (!workspace) return
    const matches = searchCustomerHistory(
      workspace.senderHistory,
      sender.contact,
      sender.name,
    )
    if (matches.length === 0) {
      setNotice('未找到寄件历史，将按新客户草稿继续。')
      return
    }
    setHistoryResults(matches)
    setOverlay('sender-history')
  }

  function openRecipientHistory(): void {
    if (!workspace) return
    const matches = searchCustomerHistory(
      workspace.recipientHistory,
      recipient.contact,
      recipient.name,
    )
    if (matches.length === 0) {
      setNotice('未找到收件历史，将按新客户草稿继续。')
      return
    }
    setHistoryResults(matches)
    setOverlay('recipient-history')
  }

  function chooseSenderHistory(record: CustomerHistoryRecord): void {
    setSender((current) => ({
      ...current,
      contact: record.contact,
      name: record.name,
      detailedAddress: record.detailedAddress,
      unit: record.unit,
      postalCode: record.postalCode,
    }))
    setSenderErrors({})
    setNotice('已载入寄件历史，可继续修改。')
    setOverlay('sender')
  }

  function chooseRecipientHistory(record: CustomerHistoryRecord): void {
    const nextRecipient = {
      contact: record.contact,
      name: record.name,
      detailedAddress: record.detailedAddress,
      unit: record.unit,
      postalCode: record.postalCode,
    }
    const inferredDestination = inferDestination(nextRecipient)
    setRecipient(nextRecipient)
    setRecipientErrors({})
    setDestinationZone(inferredDestination.zone)
    setDestinationOffice(inferredDestination.office)
    setRecipientAdministrativePrefix(inferredDestination.administrativePrefix)
    setDestinationRegion(
      inferredDestination.zone
        ? destinationRegionForZone(inferredDestination.zone)
        : 'domestic',
    )
    setNotice('已载入收件历史，可继续修改。')
    setOverlay(null)
  }

  function chooseAgreement(account: AgreementAccount): void {
    setSender((current) => ({
      ...current,
      agreementAccountId: account.id,
      agreementAccountName: account.name,
      contact: account.contact,
      name: account.senderName,
      detailedAddress: account.detailedAddress,
      unit: account.unit,
      postalCode: account.postalCode,
    }))
    setSenderErrors({})
    setNotice('已选择协议账户。')
    setOverlay('sender')
  }

  function removeAgreement(): void {
    setSender((current) => ({
      ...current,
      agreementAccountId: null,
      agreementAccountName: '',
    }))
    setNotice('协议账户已移除，其余寄件资料保持不变。')
  }

  function openAddressPicker(target: AddressTarget): void {
    setAddressPickerTarget(target)
    setAddressProvince('')
    setAddressCity('')
    setOverseasQuery('')
    setAddressTab(
      target === 'recipient' && destinationZone === 'international'
        ? 'overseas'
        : 'province',
    )
  }

  function chooseAddress(address: FictionalAddress): void {
    if (!addressPickerTarget) return
    const prefix = administrativePrefix(address)
    if (addressPickerTarget === 'sender') {
      setSender((current) => ({
        ...current,
        detailedAddress: prefix,
        postalCode: address.postalCode,
      }))
      setSenderErrors({})
    } else {
      setRecipient((current) => ({
        ...current,
        detailedAddress: prefix,
        postalCode: address.postalCode,
      }))
      setDestinationZone(address.zone)
      setDestinationOffice(address.destinationOffice ?? '')
      setDestinationRegion(destinationRegionForZone(address.zone))
      setRecipientAdministrativePrefix(prefix)
      setRecipientErrors({})
    }
    const target = addressPickerTarget
    setAddressPickerTarget(null)
    window.requestAnimationFrame(() => {
      const input = target === 'sender'
        ? senderAddressInputRef.current
        : recipientAddressInputRef.current
      input?.focus()
      input?.setSelectionRange(input.value.length, input.value.length)
    })
  }

  function chooseOverseasDestination(
    destination: InternationalDestination,
  ): void {
    if (!addressPickerTarget) return
    if (addressPickerTarget === 'sender') {
      setSender((current) => ({
        ...current,
        detailedAddress: destination.label,
        postalCode: '',
      }))
      setSenderErrors({})
    } else {
      setRecipient((current) => ({
        ...current,
        detailedAddress: destination.label,
        postalCode: '',
      }))
      setDestinationZone('international')
      setDestinationOffice(destination.code)
      setDestinationRegion('overseas')
      setRecipientAdministrativePrefix(destination.label)
      setRecipientErrors({})
    }
    setAddressPickerTarget(null)
  }

  async function chooseServiceFamily(
    label: string,
    nextTab?: ActiveServiceTab,
  ): Promise<void> {
    setAppointmentMailLocked(false)
    if (!nextTab) {
      setNotice(`${label}暂未开放。`)
      return
    }
    setActiveServiceTab(nextTab)
    if (
      nextTab === 'postal-supplies' ||
      nextTab === 'channel-products' ||
      nextTab === 'supplementary-traffic' ||
      nextTab === 'electronic-commerce'
    ) {
      setNotice('')
      return
    }
    const nextFamily = nextTab
    if (nextFamily === productFamily) {
      setNotice('')
      return
    }

    setProductFamily(nextFamily)
    setNotice('')
    if (!workspace?.draft) return
    const next = await repository.saveDraft({
      ...workspace.draft,
      productFamily: nextFamily,
      updatedAt: new Date().toISOString(),
    })
    setWorkspace(next)
  }

  function renderAddressPicker(target: AddressTarget) {
    if (addressPickerTarget !== target) return null
    const pickerLabel = target === 'sender' ? '寄件地址点选' : '收件地址点选'
    return (
      <div aria-label={pickerLabel} className="address-inline-picker" role="group">
        <div className="address-mode-tabs" role="tablist" aria-label="地址层级">
          <button
            aria-selected={addressTab === 'overseas'}
            className={addressTab === 'overseas' ? 'address-mode-tab address-mode-tab--active' : 'address-mode-tab'}
            onClick={() => setAddressTab('overseas')}
            role="tab"
            type="button"
          >
            海外
          </button>
          <button
            aria-selected={addressTab === 'province'}
            className={addressTab === 'province' ? 'address-mode-tab address-mode-tab--active' : 'address-mode-tab'}
            onClick={() => setAddressTab('province')}
            role="tab"
            type="button"
          >
            {addressProvince ? shortDivisionName(addressProvince) : '省份'}
          </button>
          <button
            aria-selected={addressTab === 'city'}
            className={addressTab === 'city' ? 'address-mode-tab address-mode-tab--active' : 'address-mode-tab'}
            disabled={!addressProvince}
            onClick={() => setAddressTab('city')}
            role="tab"
            type="button"
          >
            {addressCity ? shortDivisionName(addressCity) : '地市'}
          </button>
          <button
            aria-selected={addressTab === 'district'}
            className={addressTab === 'district' ? 'address-mode-tab address-mode-tab--active' : 'address-mode-tab'}
            disabled={!addressCity}
            onClick={() => setAddressTab('district')}
            role="tab"
            type="button"
          >
            区县
          </button>
        </div>

        {addressTab === 'overseas' ? (
          <div className="address-picker-panel" role="tabpanel">
            <div className="address-overseas-search">
              <input
                aria-label="海外寄达地检索"
                onChange={(event) => setOverseasQuery(event.target.value)}
                placeholder="输入内容可搜索"
                value={overseasQuery}
              />
              <button onClick={() => setOverseasQuery('')} type="button">清空</button>
            </div>
            <div className="address-location-grid address-location-grid--overseas">
              {overseasDestinations.map((destination) => (
                <button
                  aria-label={`${destination.label} ${destination.code}`}
                  key={destination.code}
                  onClick={() => chooseOverseasDestination(destination)}
                  type="button"
                >
                  {destination.label}
                </button>
              ))}
              {overseasDestinations.length === 0 ? (
                <p className="address-picker-empty">没有匹配结果</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {addressTab === 'province' ? (
          <div className="address-location-grid" role="tabpanel">
            {addressProvinces.map((province) => (
              <button
                key={province.id}
                onClick={() => {
                  setAddressProvince(province.fullName)
                  setAddressCity('')
                  setAddressTab('city')
                }}
                type="button"
              >
                {province.body}
              </button>
            ))}
          </div>
        ) : null}

        {addressTab === 'city' ? (
          <div className="address-location-grid" role="tabpanel">
            {addressCities.map((city) => (
              <button
                key={city.id}
                onClick={() => {
                  setAddressCity(city.fullName)
                  setAddressTab('district')
                }}
                type="button"
              >
                {city.body}
              </button>
            ))}
          </div>
        ) : null}

        {addressTab === 'district' ? (
          <div className="address-location-grid" role="tabpanel">
            {addressDistricts.map((address) => (
              <button key={address.id} onClick={() => chooseAddress(address)} type="button">
                {shortDivisionName(address.hierarchy[2]!)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  function renderRecipientSection({
    hidden,
    required,
    disabled,
  }: RecipientSectionContext) {
    if (hidden) return null

    return (
      <form className="recipient-form service-recipient-form" onSubmit={(event) => void saveRecipient(event)}>
        <div className="section-title-row">
          <div>
            <span className="section-caret">⌄</span>
            <strong>收件人信息</strong>
          </div>
        </div>
        <fieldset disabled={!workspace?.draft || disabled}>
          <div className="recipient-grid recipient-grid--top">
            <label>
              <span>{required ? <b>*</b> : null} 联系电话</span>
              <input
                aria-label="收件联系电话"
                onChange={(event) => {
                  setRecipient((current) => ({ ...current, contact: event.target.value }))
                  setRecipientErrors({})
                }}
                placeholder="请输入电话"
                value={recipient.contact}
              />
              <FieldError message={recipientErrors.contact} />
            </label>
            <label>
              <span>{required ? <b>*</b> : null} 姓名</span>
              <input
                aria-label="收件人姓名"
                onChange={(event) => {
                  setRecipient((current) => ({ ...current, name: event.target.value }))
                  setRecipientErrors({})
                }}
                placeholder="请输入姓名"
                value={recipient.name}
              />
            </label>
            {destinationZone !== 'international' ? (
              <label>
                <span>邮编</span>
                <input
                  aria-label="收件邮编"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => {
                    setRecipient((current) => ({ ...current, postalCode: event.target.value }))
                    setRecipientErrors({})
                  }}
                  placeholder="由详细地址自动匹配"
                  value={recipient.postalCode}
                />
                <FieldError message={recipientErrors.postalCode} />
              </label>
            ) : null}
          </div>
          <div className="recipient-grid recipient-grid--address">
            <label>
              <span>{required ? <b>*</b> : null} 详细地址</span>
              <div className="address-field-control" ref={recipientAddressControlRef}>
                <div className="field-with-action">
                  <input
                    aria-label="收件详细地址"
                    onClick={() => openAddressPicker('recipient')}
                    onChange={(event) => {
                      const detailedAddress = event.target.value
                      setRecipient((current) => ({ ...current, detailedAddress }))
                      if (
                        !recipientAdministrativePrefix ||
                        !detailedAddress.startsWith(recipientAdministrativePrefix)
                      ) {
                        setDestinationZone('')
                        setDestinationOffice('')
                        setRecipientAdministrativePrefix('')
                      }
                      setRecipientErrors({})
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setAddressPickerTarget(null)
                    }}
                    placeholder="请输入详细地址"
                    ref={recipientAddressInputRef}
                    value={recipient.detailedAddress}
                  />
                  <button
                    onClick={() => addressPickerTarget === 'recipient'
                      ? setAddressPickerTarget(null)
                      : openAddressPicker('recipient')}
                    type="button"
                  >
                    点选地址
                  </button>
                </div>
                {renderAddressPicker('recipient')}
              </div>
              <FieldError message={recipientErrors.detailedAddress} />
            </label>
            <label>
              <span>单位</span>
              <input
                aria-label="收件单位"
                onChange={(event) => {
                  setRecipient((current) => ({ ...current, unit: event.target.value }))
                  setRecipientErrors({})
                }}
                placeholder="请输入单位"
                value={recipient.unit}
              />
            </label>
            <button
              className="history-button"
              onClick={openRecipientHistory}
              type="button"
            >
              查询历史
            </button>
          </div>
        </fieldset>
        {recipientErrors.form ? (
          <p className="customer-form-error" role="alert">{recipientErrors.form}</p>
        ) : null}
        <section className="customer-submit-row" aria-label="客户资料保存">
          <div>
            <span>收件资料状态</span>
            <strong>{draftReady ? '已保存' : required ? '办理前必须保存' : '可选采集'}</strong>
          </div>
          <button
            className="primary-button primary-button--compact"
            disabled={disabled}
            type="submit"
          >
            {draftReady ? '更新收件资料' : required ? '保存收件资料' : '保存可选资料'}
          </button>
        </section>
      </form>
    )
  }

  if (!workspace) {
    return (
      <section className="customer-loading" aria-live="polite">
        正在准备客户资料…
      </section>
    )
  }

  return (
    <>
      <div className="customer-workspace">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">
            首页
          </button>
          <span>/</span>
          <span>业务办理</span>
          <span>/</span>
          <strong>综合受理</strong>
        </div>

        <div aria-label="当前客户业务汇总" className="customer-summary-bar">
          <span>当前客户信息</span>
          <strong className="customer-summary-name">
            {workspace.draft?.sender.name || '尚未采集'}
          </strong>
          <span>总件数</span>
          <strong className="customer-summary-number">{serviceSummary.count}</strong>
          <span>总金额</span>
          <strong className="customer-summary-number">
            {formatCents(serviceSummary.totalCents)}
          </strong>
          <div className="customer-summary-actions">
            <button
              className="customer-settlement-button"
              onClick={onOpenSettlement}
              type="button"
            >
              结算中心
            </button>
            <button className="customer-interrupt-button" onClick={onBack} type="button">
              中断
            </button>
          </div>
        </div>

        <nav className="service-family-tabs" aria-label="业务类别">
          {serviceFamilyTabs.map(
            ({ label, tab }) => {
              const active = tab === activeServiceTab
              return (
                <button
                  aria-current={active ? 'page' : undefined}
                  className={active
                    ? 'service-family-tab service-family-tab--active'
                    : 'service-family-tab'}
                  key={label}
                  onClick={() => void chooseServiceFamily(label, tab)}
                  type="button"
                >
                  {label}
                </button>
              )
            },
          )}
        </nav>

        <section className="intake-panel">
          <div className="intake-toolbar">
            <label>
              <span>业务类别</span>
              <select
                aria-label="业务类别"
                disabled
                value={activeServiceTab}
              >
                <option value="basic-letter">平函</option>
                <option value="standard-delivery">挂函</option>
                <option value="parcel">包裹</option>
                <option value="express">特快</option>
                <option value="postal-supplies">用邮物品</option>
                <option value="channel-products">商品销售</option>
                <option value="supplementary-traffic">补录/交管</option>
                <option value="electronic-commerce">电子商务</option>
              </select>
            </label>
            <div className="intake-toolbar-actions">
              <button
                className="secondary-button secondary-button--small"
                disabled={appointmentMailLocked}
                onClick={() => setOverlay('sender')}
                title={appointmentMailLocked ? '当前预约来源的寄收件信息不可修改' : undefined}
                type="button"
              >
                {workspace.draft ? '修改寄件资料' : '采集寄件资料'}
              </button>
            </div>
          </div>

          {workspace.draft ? (
            <div className="sender-strip" aria-label="寄件资料摘要">
              <span>寄件人</span>
              <strong>{sender.name || '未填写姓名'}</strong>
              <span>{sender.contact || '未填写电话'}</span>
              <span>{sender.detailedAddress || sender.unit}</span>
              {sender.agreementAccountId ? (
                <span className="agreement-chip">协议 {sender.agreementAccountId}</span>
              ) : null}
            </div>
          ) : (
            <div className="sender-strip sender-strip--empty">
              必须先完成寄件资料，才能继续收件资料采集。
            </div>
          )}

          {notice ? <p className="customer-notice" role="status">{notice}</p> : null}

          {workspace.draft && activeServiceTab === 'electronic-commerce' ? (
            <ElectronicCommerceWorkspace
              onOpenSettlement={onOpenSettlement}
              onSummaryChange={handleServiceSummary}
              repository={serviceRepository}
            />
          ) : workspace.draft && activeServiceTab === 'supplementary-traffic' ? (
            <SupplementaryTrafficWorkspace
              customerDraft={workspace.draft}
              onOpenSettlement={onOpenSettlement}
              onSummaryChange={handleServiceSummary}
              repository={serviceRepository}
            />
          ) : workspace.draft && activeServiceTab === 'channel-products' ? (
            <ChannelProductSalesWorkspace
              customerDraft={workspace.draft}
              onOpenSettlement={onOpenSettlement}
              onSummaryChange={handleServiceSummary}
              repository={serviceRepository}
            />
          ) : workspace.draft && activeServiceTab === 'postal-supplies' ? (
            <PostalSuppliesWorkspace
              customerDraft={workspace.draft}
              onOpenSettlement={onOpenSettlement}
              onSummaryChange={handleServiceSummary}
              repository={serviceRepository}
            />
          ) : workspace.draft ? (
            <ServiceIntakePanel
              addressDestinationOffice={destinationOffice}
              addressDestinationZone={destinationZone}
              customerDraft={{ ...workspace.draft, productFamily }}
              customerRepository={repository}
              initialRecommendation={initialRecommendation}
              key={`${productFamily}:${initialRecommendation?.id ?? 'direct'}`}
              onAppointmentCustomerLoaded={loadAppointmentCustomer}
              onAppointmentLockChange={handleAppointmentLockChange}
              onCustomerCommitted={setWorkspace}
              onOpenSettlement={onOpenSettlement}
              onRequestSenderIdentity={() => setOverlay('sender')}
              onSummaryChange={handleServiceSummary}
              renderRecipientSection={renderRecipientSection}
              repository={serviceRepository}
            />
          ) : (
            <section className="transaction-placeholder" aria-label="业务受理等待">
              <div>
                <span>下一步</span>
                <strong>业务受理、计费、提交与结算</strong>
              </div>
            </section>
          )}
        </section>
      </div>

      {overlay === 'sender' ? (
        <Modal
          eyebrow="综合受理"
          title="寄件资料采集"
          wide
        >
          <form className="modal-form customer-modal-form" onSubmit={(event) => void saveSender(event)}>
            <div className="agreement-search-row">
              <label>
                <span>协议账户查询</span>
                <input
                  aria-label="协议账户查询"
                  onChange={(event) => setAgreementQuery(event.target.value)}
                  placeholder="输入 14 位编号、完整名称或助记码"
                  value={agreementQuery}
                />
              </label>
              <button
                className="table-action"
                onClick={() => setOverlay('agreement')}
                type="button"
              >
                查询协议
              </button>
              {sender.agreementAccountId ? (
                <button className="danger-button" onClick={removeAgreement} type="button">
                  移除协议
                </button>
              ) : null}
            </div>

            <div className="selected-agreement">
              <span>协议账户编号</span>
              <strong>{sender.agreementAccountId ?? '未选择'}</strong>
              <span>协议账户名称</span>
              <strong>{sender.agreementAccountName || '—'}</strong>
            </div>

            <div className="sender-grid">
              <label>
                <span><b>*</b> 联系电话</span>
                <input
                  aria-label="寄件联系电话"
                  onChange={(event) => {
                    setSender((current) => ({ ...current, contact: event.target.value }))
                    setSenderErrors({})
                  }}
                  placeholder="请输入电话"
                  value={sender.contact}
                />
                <FieldError message={senderErrors.contact} />
              </label>
              <label>
                <span><b>*</b> 姓名</span>
                <input
                  aria-label="寄件人姓名"
                  onChange={(event) => {
                    setSender((current) => ({ ...current, name: event.target.value }))
                    setSenderErrors({})
                  }}
                  placeholder="请输入姓名"
                  value={sender.name}
                />
              </label>
              <label>
                <span>{identityRequired ? <b>*</b> : null} 身份证明类型</span>
                <select
                  aria-label="身份证明类型"
                  onChange={(event) => {
                    setSender((current) => ({
                      ...current,
                      identityType: event.target.value as SenderProfile['identityType'],
                    }))
                    setSenderErrors({})
                  }}
                  value={sender.identityType}
                >
                  <option value="">请选择</option>
                  <option value="primary">居民身份证</option>
                  <option value="temporary">临时身份证明</option>
                  <option value="residence">居留证明</option>
                  <option value="travel">旅行证明</option>
                </select>
                <FieldError message={senderErrors.identityType} />
              </label>
              <label>
                <span>{identityRequired ? <b>*</b> : null} 身份证明号码</span>
                <input
                  aria-label="身份证明号码"
                  maxLength={sender.identityType === 'primary' ? 18 : 20}
                  onChange={(event) => {
                    setSender((current) => ({ ...current, identityValue: event.target.value }))
                    setSenderErrors({})
                  }}
                  placeholder="请输入证件号码"
                  value={sender.identityValue}
                />
                <FieldError message={senderErrors.identityValue} />
              </label>
              <label>
                <span>性别</span>
                <select
                  aria-label="性别"
                  onChange={(event) =>
                    setSender((current) => ({
                      ...current,
                      gender: event.target.value as SenderProfile['gender'],
                    }))
                  }
                  value={sender.gender}
                >
                  <option value="">请选择</option>
                  <option value="female">女</option>
                  <option value="male">男</option>
                  <option value="unspecified">不指定</option>
                </select>
              </label>
              <label className="sender-address-field">
                <span><b>*</b> 详细地址</span>
                <div className="address-field-control" ref={senderAddressControlRef}>
                  <div className="field-with-action">
                    <input
                      aria-label="寄件详细地址"
                      onClick={() => openAddressPicker('sender')}
                      onChange={(event) => {
                        setSender((current) => ({
                          ...current,
                          detailedAddress: event.target.value,
                        }))
                        setSenderErrors({})
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setAddressPickerTarget(null)
                      }}
                      placeholder="请输入详细地址"
                      ref={senderAddressInputRef}
                      value={sender.detailedAddress}
                    />
                    <button
                      onClick={() => addressPickerTarget === 'sender'
                        ? setAddressPickerTarget(null)
                        : openAddressPicker('sender')}
                      type="button"
                    >
                      点选地址
                    </button>
                  </div>
                  {renderAddressPicker('sender')}
                </div>
                <FieldError message={senderErrors.detailedAddress} />
              </label>
              <label className="sender-unit-field">
                <span>单位</span>
                <input
                  aria-label="寄件单位"
                  onChange={(event) => {
                    setSender((current) => ({ ...current, unit: event.target.value }))
                    setSenderErrors({})
                  }}
                  placeholder="请输入单位"
                  value={sender.unit}
                />
              </label>
              <label>
                <span>邮编</span>
                <input
                  aria-label="寄件邮编"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => {
                    setSender((current) => ({ ...current, postalCode: event.target.value }))
                    setSenderErrors({})
                  }}
                  placeholder="请输入六位邮编"
                  value={sender.postalCode}
                />
                <FieldError message={senderErrors.postalCode} />
              </label>
            </div>
            {senderErrors.form ? (
              <p className="customer-form-error" role="alert">{senderErrors.form}</p>
            ) : null}
            <div className="modal-actions modal-actions--split">
              <button className="secondary-button" onClick={openSenderHistory} type="button">
                查询历史
              </button>
              <div>
                <button className="primary-button primary-button--compact" type="submit">
                  确定
                </button>
                <button className="secondary-button" onClick={() => setOverlay(null)} type="button">
                  取消
                </button>
              </div>
            </div>
          </form>
        </Modal>
      ) : null}

      {overlay === 'agreement' ? (
        <Modal
          eyebrow="寄件资料"
          title="协议账户选择"
          wide
        >
          <div className="modal-form">
            <div className="customer-table-wrap">
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>序号</th>
                    <th>协议账户编号</th>
                    <th>协议账户名称</th>
                    <th>助记码</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {agreementResults.map((account, index) => (
                    <tr key={account.id}>
                      <td>{index + 1}</td>
                      <td>{account.id}</td>
                      <td>{account.name}</td>
                      <td>{account.mnemonic}</td>
                      <td><span className="status-pill">有效</span></td>
                      <td>
                        <button className="table-action" onClick={() => chooseAgreement(account)} type="button">
                          选择
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {agreementResults.length === 0 ? (
                <p className="empty-table">没有匹配的协议账户。</p>
              ) : null}
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setOverlay('sender')} type="button">
                返回
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {overlay === 'sender-history' ? (
        <Modal
          eyebrow="寄件资料"
          title="寄件历史选择"
          wide
        >
          <div className="modal-form">
            <HistoryTable onSelect={chooseSenderHistory} records={historyResults} />
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setOverlay('sender')} type="button">
                返回
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {overlay === 'recipient-history' ? (
        <Modal
          eyebrow="收件资料"
          title="收件历史选择"
          wide
        >
          <div className="modal-form">
            <HistoryTable onSelect={chooseRecipientHistory} records={historyResults} />
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setOverlay(null)} type="button">
                返回
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

    </>
  )
}
