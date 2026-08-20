import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import { validateSender, type CustomerErrors } from '../../domain/customer/policy'
import type { CustomerRepository } from '../../domain/customer/repository'
import { createEmptyRecipient, createEmptySender } from '../../domain/customer/seed'
import type {
  AgreementAccount,
  CustomerWorkspaceState,
  SenderProfile,
} from '../../domain/customer/types'
import {
  activeBulkSealBags,
  bulkEligibleProducts,
  createBulkFailureWorkbook,
  createBulkTemplateWorkbook,
  parseBulkTemplate,
} from '../../domain/service/bulk'
import {
  formatCents,
  serviceItemCodeRule,
  serviceRequiresPlatformQuote,
} from '../../domain/service/policy'
import { INTERNATIONAL_DESTINATIONS } from '../../domain/service/international'
import type { ServiceRepository } from '../../domain/service/repository'
import { createEmptyServiceDraft } from '../../domain/service/seed'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import type {
  BulkBatch,
  BulkDocumentKind,
  BulkNumberAllocation,
  BulkPrintRequirement,
  DispatchBagShift,
  ParcelTariffZone,
  ServiceDestinationZone,
  ServiceOperatorSnapshot,
  ServicePaymentMethod,
  ServiceProduct,
  ServiceRemark,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { CurrencyInput } from '../../ui/CurrencyInput'
import { Modal } from '../../ui/Modal'
import { AgreementCustomerRegistrationModal } from './AgreementCustomerRegistrationModal'
import { BulkMailLabelPrintModal } from './BulkMailLabelPrintModal'
import {
  BulkInvoiceRegistrationModal,
  type BulkInvoiceDraft,
} from './BulkInvoiceRegistrationModal'
import { BulkSettlementDocumentsModal } from './BulkSettlementDocumentsModal'

interface BulkIntakeWorkspaceProps {
  customerRepository: CustomerRepository
  institutionCode: string
  serviceRepository: ServiceRepository
  operator: ServiceOperatorSnapshot
  onBack: () => void
}

type DetailView = 'success' | 'processing' | null
type RegistrationView = 'registration' | 'query'

interface BulkQueryCriteria {
  batchId: string
  operator: string
  status: string
  dateFrom: string
  dateTo: string
}

const paymentLabels: Record<ServicePaymentMethod, string> = {
  'cash-settlement': '现结',
  stamp: '贴票',
  'self-affixed': '自贴票',
  credit: '记欠',
}

const printLabels: Record<BulkPrintRequirement, string> = {
  normal: '正常打印',
  all: '全量打印',
  none: '无须打印',
}

const zoneLabels: Record<Exclude<ServiceDestinationZone, ''>, string> = {
  local: '本埠',
  nonlocal: '外埠',
  international: '国际',
  'special-free-trade-port': '自贸港',
  'special-mirror-sea-port': '镜海埠',
  'special-beautiful-island': '美丽岛',
}

function today(): string {
  return businessCalendarDay(new Date())
}

function downloadWorkbook(source: string, fileName: string): void {
  const blob = new Blob([`\uFEFF${source}`], {
    type: 'application/vnd.ms-excel;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function productOptionLabel(product: ServiceProduct): string {
  return `${product.searchCode} ${product.label}`
}

function FieldError({ message }: { message?: string }) {
  return message ? <span className="customer-field-error">{message}</span> : null
}

function batchStatusLabel(batch: BulkBatch): string {
  if (batch.failedCount > 0) return '部分失败'
  return batch.settlementStatus === 'settled' ? '已结算' : '已处理'
}

function uniqueZones(product: ServiceProduct | undefined) {
  if (!product) return []
  return [...new Set(product.destinationZones.filter(Boolean))] as Array<Exclude<ServiceDestinationZone, ''>>
}

export function BulkIntakeWorkspace({
  customerRepository,
  institutionCode,
  serviceRepository,
  operator,
  onBack,
}: BulkIntakeWorkspaceProps) {
  const [customerState, setCustomerState] = useState<CustomerWorkspaceState | null>(null)
  const [serviceState, setServiceState] = useState<ServiceWorkspaceState | null>(null)
  const [customerDialogOpen, setCustomerDialogOpen] = useState(true)
  const [sender, setSender] = useState<SenderProfile>(createEmptySender)
  const [accountId, setAccountId] = useState('')
  const [customerErrors, setCustomerErrors] = useState<CustomerErrors>({})
  const [customerFormError, setCustomerFormError] = useState('')
  const [registrationView, setRegistrationView] = useState<RegistrationView>('registration')
  const [registrationOpen, setRegistrationOpen] = useState(false)

  const products = useMemo(() => bulkEligibleProducts(), [])
  const [productId, setProductId] = useState('')
  const selectedProduct = products.find((product) => product.id === productId)
  const availableZones = uniqueZones(selectedProduct)
  const [paymentMethod, setPaymentMethod] = useState<ServicePaymentMethod>('cash-settlement')
  const [acceptanceDate, setAcceptanceDate] = useState(today)
  const [printRequirement, setPrintRequirement] = useState<BulkPrintRequirement>('normal')
  const [numberAllocation, setNumberAllocation] = useState<BulkNumberAllocation>('automatic')
  const [startingItemCode, setStartingItemCode] = useState('')
  const [fallbackZone, setFallbackZone] = useState<Exclude<ServiceDestinationZone, ''>>('nonlocal')
  const [internationalDestinationCode, setInternationalDestinationCode] = useState('AU')
  const [remark, setRemark] = useState<ServiceRemark>('ordinary-letter')
  const [remarkLabel, setRemarkLabel] = useState('无')
  const [weightInput, setWeightInput] = useState('')
  const [insuranceValueCents, setInsuranceValueCents] = useState<number | null>(null)
  const [declaredValueCents, setDeclaredValueCents] = useState<number | null>(null)
  const [stampAmountCents, setStampAmountCents] = useState<number | null>(null)
  const [contents, setContents] = useState('')
  const [parcelTariffZone, setParcelTariffZone] = useState<ParcelTariffZone>('')
  const [platformQuoteCents, setPlatformQuoteCents] = useState<number | null>(null)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [queryBatchId, setQueryBatchId] = useState('')
  const [queryOperator, setQueryOperator] = useState('')
  const [queryStatus, setQueryStatus] = useState('all')
  const [queryDateFrom, setQueryDateFrom] = useState(today)
  const [queryDateTo, setQueryDateTo] = useState(today)
  const [appliedQuery, setAppliedQuery] = useState<BulkQueryCriteria>({
    batchId: '',
    operator: '',
    status: 'all',
    dateFrom: queryDateFrom,
    dateTo: queryDateTo,
  })

  const [detailBatchId, setDetailBatchId] = useState('')
  const [detailView, setDetailView] = useState<DetailView>(null)
  const [printBatchId, setPrintBatchId] = useState('')
  const [printMode, setPrintMode] = useState<'settlement' | 'reprint'>('reprint')
  const [labelBatchId, setLabelBatchId] = useState('')
  const [invoiceBatchId, setInvoiceBatchId] = useState('')
  const [sealBatchId, setSealBatchId] = useState('')
  const [sealTagBatchId, setSealTagBatchId] = useState('')
  const [dispatchShift, setDispatchShift] = useState<DispatchBagShift>('01')
  const [receptacleType, setReceptacleType] = useState<'1.袋'>('1.袋')
  const [itemsPerBag, setItemsPerBag] = useState('6')

  useEffect(() => {
    let active = true
    void Promise.all([customerRepository.load(), serviceRepository.load()]).then(
      ([customers, services]) => {
        if (!active) return
        setCustomerState(customers)
        setServiceState(services)
        if (customers.draft) {
          setSender(customers.draft.sender)
          setAccountId(customers.draft.sender.agreementAccountId ?? '')
        }
      },
    )
    return () => {
      active = false
    }
  }, [customerRepository, serviceRepository])

  const draftForProduct = selectedProduct
    ? {
        ...createEmptyServiceDraft(true, fallbackZone),
        productId: selectedProduct.id,
        parcelTariffZone,
      }
    : null
  const needsPlatformQuote = Boolean(
    selectedProduct && draftForProduct &&
    serviceRequiresPlatformQuote(draftForProduct, selectedProduct),
  )
  const itemCodeRule = selectedProduct
    ? serviceItemCodeRule(selectedProduct, fallbackZone)
    : 'none'
  const selectedAccount = customerState?.agreementAccounts.find(
    (account) => account.id === accountId,
  )
  const customerReady = Boolean(
    sender.agreementAccountId && sender.identityType && sender.identityValue.trim(),
  )

  const visibleBatches = useMemo(() => {
    const batches = serviceState?.bulkBatches ?? []
    return batches.filter((batch) => {
      if (appliedQuery.batchId.trim() && !batch.id.includes(appliedQuery.batchId.trim())) return false
      if (appliedQuery.operator.trim() && !(
        batch.operator.operatorId.includes(appliedQuery.operator.trim()) ||
        batch.operator.displayName.includes(appliedQuery.operator.trim())
      )) return false
      if (appliedQuery.status === 'settled' && batch.settlementStatus !== 'settled') return false
      if (appliedQuery.status === 'unsettled' && batch.settlementStatus !== 'unsettled') return false
      if (appliedQuery.status === 'failed' && batch.failedCount === 0) return false
      if (appliedQuery.dateFrom && batch.acceptanceDate < appliedQuery.dateFrom) return false
      if (appliedQuery.dateTo && batch.acceptanceDate > appliedQuery.dateTo) return false
      return true
    })
  }, [appliedQuery, serviceState])

  const detailBatch = serviceState?.bulkBatches.find((batch) => batch.id === detailBatchId)
  const printBatch = serviceState?.bulkBatches.find((batch) => batch.id === printBatchId)
  const labelBatch = serviceState?.bulkBatches.find((batch) => batch.id === labelBatchId)
  const invoiceBatch = serviceState?.bulkBatches.find((batch) => batch.id === invoiceBatchId)
  const sealBatch = serviceState?.bulkBatches.find((batch) => batch.id === sealBatchId)
  const sealTagBatch = serviceState?.bulkBatches.find((batch) => batch.id === sealTagBatchId)
  const sealTagBags = serviceState && sealTagBatch
    ? activeBulkSealBags(serviceState, sealTagBatch)
    : []

  function selectAccount(value: string): void {
    setAccountId(value)
    setCustomerFormError('')
    const account = customerState?.agreementAccounts.find((candidate) => candidate.id === value)
    if (!account) return
    setSender((current) => ({
      ...current,
      agreementAccountId: account.id,
      agreementAccountName: account.name,
      contact: account.contact,
      name: account.senderName,
      detailedAddress: account.detailedAddress,
      unit: account.unit,
      postalCode: account.postalCode,
      identityType: account.identityType ?? current.identityType,
      identityValue: account.identityValue ?? current.identityValue,
      gender: account.gender ?? current.gender,
    }))
    setPaymentMethod(account.paymentMethod ?? 'cash-settlement')
  }

  function selectApprovedAccount(
    nextState: CustomerWorkspaceState,
    account: AgreementAccount,
  ): void {
    setCustomerState(nextState)
    setAccountId(account.id)
    setSender((current) => ({
      ...current,
      agreementAccountId: account.id,
      agreementAccountName: account.name,
      contact: account.contact,
      name: account.senderName,
      detailedAddress: account.detailedAddress,
      unit: account.unit,
      postalCode: account.postalCode,
      identityType: account.identityType ?? current.identityType,
      identityValue: account.identityValue ?? current.identityValue,
      gender: account.gender ?? current.gender,
    }))
    setPaymentMethod(account.paymentMethod ?? 'cash-settlement')
    setRegistrationOpen(false)
    setCustomerFormError('')
  }

  function selectProduct(value: string): void {
    setProductId(value)
    const product = products.find((candidate) => candidate.id === value)
    if (product) {
      const zones = uniqueZones(product)
      if (!zones.includes(fallbackZone) && zones[0]) setFallbackZone(zones[0])
      setRemark(product.remarkOptions[0] ?? 'ordinary-letter')
      setRemarkLabel(product.searchCode === '303' ? 'A款' : '无')
    }
    setStartingItemCode('')
    setParcelTariffZone('')
    setPlatformQuoteCents(null)
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!customerState) return
    if (!selectedAccount) {
      setCustomerFormError('大宗收寄必须选择协议客户。')
      return
    }
    const validation = validateSender(sender, true)
    if (!validation.valid) {
      setCustomerErrors(validation.errors)
      return
    }
    const next = await customerRepository.saveDraft({
      productFamily: selectedProduct?.productFamily ?? 'parcel',
      destinationRegion: fallbackZone === 'international' ? 'overseas' : 'domestic',
      sender: {
        ...sender,
        agreementAccountId: selectedAccount.id,
        agreementAccountName: selectedAccount.name,
      },
      recipient: customerState.draft?.recipient ?? createEmptyRecipient(),
      status: 'sender-ready',
      updatedAt: new Date().toISOString(),
    })
    setCustomerState(next)
    setSender(next.draft!.sender)
    setCustomerErrors({})
    setCustomerFormError('')
    setCustomerDialogOpen(false)
  }

  function downloadTemplate(): void {
    downloadWorkbook(
      createBulkTemplateWorkbook(sender.agreementAccountId ?? accountId),
      '大宗导入模板.xls',
    )
  }

  async function importFile(): Promise<void> {
    setError('')
    setMessage('')
    if (!customerReady) {
      setError('请先完成协议客户和寄件人实名信息采集。')
      setCustomerDialogOpen(true)
      return
    }
    if (!selectedProduct) {
      setError('请选择业务产品。')
      return
    }
    if (!sourceFile) {
      setError('请选择大宗导入文件。')
      return
    }
    if (!sourceFile.name.toLowerCase().endsWith('.xls')) {
      setError('大宗导入模板必须为 .xls 格式，不能使用 .xlsx 或 .et。')
      return
    }
    if (sourceFile.size > 4 * 1024 * 1024) {
      setError('大宗导入文件超过 4 MB，未执行导入。')
      return
    }
    const weight = weightInput.trim() ? Number(weightInput) : null
    if (weight !== null && (!Number.isInteger(weight) || weight < 1)) {
      setError('公共邮件重量必须为大于 0 的整数克数。')
      return
    }
    try {
      const rows = parseBulkTemplate(await sourceFile.text())
      const imported = await serviceRepository.importBulkBatch({
        importedAt: new Date().toISOString(),
        acceptanceDate,
        sourceFileName: sourceFile.name,
        productId: selectedProduct.id,
        paymentMethod,
        printRequirement,
        numberAllocation,
        startingItemCode,
        fallbackDestinationZone: fallbackZone,
        internationalDestinationCode,
        agreementAccountId: sender.agreementAccountId!,
        agreementAccountName: sender.agreementAccountName,
        sender,
        operator,
        common: {
          remark,
          remarkLabel,
          weightGrams: weight,
          insuranceValueCents,
          declaredValueCents,
          stampAmountCents,
          contents,
          parcelTariffZone,
          platformQuoteCents,
        },
        rows,
      })
      setServiceState(imported.state)
      setMessage(
        `批次 ${imported.batch.id} 已完成处理：总数 ${imported.batch.totalCount}，成功 ${imported.batch.successCount}，失败 ${imported.batch.failedCount}。`,
      )
      setDetailBatchId(imported.batch.id)
      setDetailView('success')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '大宗导入处理失败。')
    }
  }

  async function settleBatch(batch: BulkBatch): Promise<void> {
    setError('')
    try {
      const settled = await serviceRepository.settleBulkBatch(
        batch.id,
        new Date().toISOString(),
      )
      setServiceState(settled.state)
      setDetailView(null)
      if (settled.batch.successCount >= settled.batch.bulkThreshold) {
        setPrintMode('settlement')
        setPrintBatchId(settled.batch.id)
        setMessage(`批次 ${batch.id} 已结算，已达到大宗标准，请选择交寄单据。`)
      } else {
        setInvoiceBatchId(settled.batch.id)
        setMessage(`批次 ${batch.id} 已结算。`)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '大宗批次结算失败。')
    }
  }

  async function completeDocumentPrompt(
    documentKinds: BulkDocumentKind[],
  ): Promise<void> {
    if (!printBatch) return
    const batchIdValue = printBatch.id
    const recorded = await serviceRepository.recordBulkDocumentPrompt({
      batchId: batchIdValue,
      documentKinds,
      handledAt: new Date().toISOString(),
      fromSequence: 1,
      toSequence: printBatch.successCount,
    })
    setServiceState(recorded.state)
    setPrintBatchId('')
    if (printMode === 'settlement') {
      setInvoiceBatchId(batchIdValue)
      setMessage(documentKinds.length > 0
        ? `批次 ${batchIdValue} 已生成 ${documentKinds.length} 种大宗打印单据。`
        : `批次 ${batchIdValue} 已登记暂不打印大宗单据。`)
    } else {
      setMessage(`批次 ${batchIdValue} 已补打 ${documentKinds.length} 种大宗单据。`)
    }
  }

  async function completeLabelPrint(
    fromSequence: number,
    toSequence: number,
    detailSheet: boolean,
  ): Promise<void> {
    if (!labelBatch) return
    const recorded = await serviceRepository.recordBulkMailLabelPrint({
      batchId: labelBatch.id,
      printedAt: new Date().toISOString(),
      fromSequence,
      toSequence,
      detailSheet,
    })
    setServiceState(recorded.state)
    setLabelBatchId('')
    setMessage(`批次 ${labelBatch.id} 已记录面单打印范围 ${fromSequence}～${toSequence}。`)
  }

  async function chooseInvoice(requested: boolean): Promise<void> {
    if (!invoiceBatch) return
    setError('')
    try {
      const recorded = await serviceRepository.recordBulkInvoiceChoice(
        invoiceBatch.id,
        requested,
      )
      setServiceState(recorded.state)
      if (!requested) {
        setInvoiceBatchId('')
        setMessage(`批次 ${invoiceBatch.id} 已登记不需要电子发票。`)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '电子发票选择记录失败。')
    }
  }

  async function openInvoice(batch: BulkBatch): Promise<void> {
    setError('')
    try {
      if (batch.invoiceRequested === false) {
        const recorded = await serviceRepository.recordBulkInvoiceChoice(batch.id, true)
        setServiceState(recorded.state)
      }
      setInvoiceBatchId(batch.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '电子发票入口打开失败。')
    }
  }

  async function submitInvoice(draft: BulkInvoiceDraft): Promise<void> {
    if (!invoiceBatch) return
    const recorded = await serviceRepository.registerBulkInvoice({
      ...draft,
      batchId: invoiceBatch.id,
      issuedAt: new Date().toISOString(),
    })
    setServiceState(recorded.state)
  }

  async function decideInvoiceDelivery(requested: boolean): Promise<void> {
    if (!invoiceBatch) return
    setError('')
    try {
      const recorded = await serviceRepository.recordBulkInvoiceDelivery({
        batchId: invoiceBatch.id,
        requested,
        decidedAt: new Date().toISOString(),
      })
      setServiceState(recorded.state)
      setInvoiceBatchId('')
      setMessage(requested
        ? `批次 ${invoiceBatch.id} 电子发票已登记并完成模拟交付。`
        : `批次 ${invoiceBatch.id} 电子发票已登记，暂不交付。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '电子发票交付选择记录失败。')
    }
  }

  async function deleteBatch(batch: BulkBatch): Promise<void> {
    setError('')
    try {
      const next = await serviceRepository.deleteBulkBatch(batch.id)
      setServiceState(next)
      setDetailView(null)
      setMessage(`批次 ${batch.id} 已删除。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '批次删除失败。')
    }
  }

  async function submitSeal(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!sealBatch) return
    setError('')
    try {
      const sealed = await serviceRepository.sealBulkBatch({
        batchId: sealBatch.id,
        sealedAt: new Date().toISOString(),
        dispatchShift,
        receptacleType,
        itemsPerBag: Number(itemsPerBag),
        institutionCode,
        operator,
      })
      setServiceState(sealed.state)
      setSealBatchId('')
      setSealTagBatchId(sealed.batch.id)
      setMessage(`批次 ${sealBatch.id} 直封成功，已生成 ${sealed.batch.seal?.bagIds?.length ?? 0} 个统一总包。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '直封处理失败。')
    }
  }

  async function decideSealTagPrint(print: boolean): Promise<void> {
    if (!sealTagBatch) return
    setError('')
    try {
      if (print) {
        document.body.classList.add('bulk-bag-tags-printing')
        try {
          window.print()
        } finally {
          document.body.classList.remove('bulk-bag-tags-printing')
        }
      }
      const recorded = await serviceRepository.recordBulkSealTagDecision({
        batchId: sealTagBatch.id,
        print,
        decidedAt: new Date().toISOString(),
      })
      setServiceState(recorded.state)
      setSealTagBatchId('')
      setMessage(print
        ? `批次 ${sealTagBatch.id} 已打印 ${sealTagBags.length} 张袋牌，下一步可生成路单。`
        : `批次 ${sealTagBatch.id} 已登记暂不打印袋牌，下一步可生成路单。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '袋牌打印决定记录失败。')
    }
  }

  if (!customerState || !serviceState) {
    return <section className="bulk-loading">正在准备大宗处理数据…</section>
  }

  return (
    <>
      <section className="bulk-workspace">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">首页</button>
          <span>/</span><span>业务办理</span><span>/</span><strong>大宗处理</strong>
        </div>

        <nav aria-label="大宗处理页签" className="bulk-subtabs">
          <button aria-current="page" type="button">大宗导入</button>
          <button onClick={() => setCustomerDialogOpen(true)} type="button">当前客户信息</button>
        </nav>

        <section className="bulk-section">
          <header><span>⌄</span><strong>导入处理</strong></header>
          <div className="bulk-form-grid">
            <label>
              <span><b>*</b> 业务产品</span>
              <select aria-label="大宗业务产品" onChange={(event) => selectProduct(event.target.value)} value={productId}>
                <option value="">请选择业务产品</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>{productOptionLabel(product)}</option>
                ))}
              </select>
            </label>
            <label>
              <span><b>*</b> 付费方式</span>
              <select aria-label="大宗付费方式" onChange={(event) => setPaymentMethod(event.target.value as ServicePaymentMethod)} value={paymentMethod}>
                {Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span><b>*</b> 收寄日期</span>
              <input aria-label="大宗收寄日期" onChange={(event) => setAcceptanceDate(event.target.value)} type="date" value={acceptanceDate} />
            </label>
            <label>
              <span>地址无法识别时按</span>
              <select aria-label="大宗默认区域" disabled={!selectedProduct} onChange={(event) => setFallbackZone(event.target.value as Exclude<ServiceDestinationZone, ''>)} value={fallbackZone}>
                {availableZones.map((zone) => <option key={zone} value={zone}>{zoneLabels[zone]}</option>)}
              </select>
            </label>
            <fieldset className="bulk-radio-field">
              <legend>打印要求</legend>
              {Object.entries(printLabels).map(([value, label]) => (
                <label key={value}><input checked={printRequirement === value} name="bulk-print" onChange={() => setPrintRequirement(value as BulkPrintRequirement)} type="radio" />{label}</label>
              ))}
            </fieldset>
            <label>
              <span>处理类型</span>
              <input aria-label="大宗处理类型" readOnly value="1：全信息，不提供详情单打印" />
            </label>
            <label>
              <span>大宗件数标准</span>
              <input aria-label="大宗件数标准" readOnly value="5件及以上" />
            </label>
            <label>
              <span>自动分配邮件号码</span>
              <select aria-label="大宗号码分配方式" onChange={(event) => setNumberAllocation(event.target.value as BulkNumberAllocation)} value={numberAllocation}>
                <option value="automatic">自动分配</option>
                <option value="manual">非自动分配</option>
              </select>
            </label>
            {numberAllocation === 'automatic' && itemCodeRule !== 'none' ? (
              <label>
                <span><b>*</b> 邮件号码起号</span>
                <input aria-label="大宗邮件号码起号" onChange={(event) => setStartingItemCode(event.target.value.toUpperCase())} value={startingItemCode} />
              </label>
            ) : <span />}
            {fallbackZone === 'international' ? (
              <label>
                <span><b>*</b> 国际寄达国家</span>
                <select aria-label="大宗国际寄达国家" onChange={(event) => setInternationalDestinationCode(event.target.value)} value={internationalDestinationCode}>
                  {INTERNATIONAL_DESTINATIONS.map((destination) => (
                    <option key={destination.code} value={destination.code}>{destination.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              <span>备注</span>
              {selectedProduct?.searchCode === '303' ? (
                <select aria-label="大宗邮件备注" onChange={(event) => setRemarkLabel(event.target.value)} value={remarkLabel}>
                  <option value="A款">A款</option><option value="B款">B款</option>
                </select>
              ) : selectedProduct && selectedProduct.remarkOptions.length > 0 ? (
                <select aria-label="大宗邮件备注" onChange={(event) => { setRemark(event.target.value as ServiceRemark); setRemarkLabel(event.target.selectedOptions[0]?.text ?? '无') }} value={remark}>
                  {selectedProduct.remarkOptions.map((value) => <option key={value} value={value}>{value === 'ordinary-letter' ? '平信' : value === 'postcard' ? '明信片' : value === 'people-letter' ? '人民来信' : value === 'document' ? '文' : value === 'goods' ? '物' : value}</option>)}
                </select>
              ) : <input aria-label="大宗邮件备注" readOnly value="无" />}
            </label>
            <label><span>邮件重量（克）</span><input aria-label="大宗公共邮件重量" inputMode="numeric" onChange={(event) => setWeightInput(event.target.value)} value={weightInput} /></label>
            <label><span>保险金额</span><CurrencyInput aria-label="大宗保险金额" onValueChange={setInsuranceValueCents} valueCents={insuranceValueCents} /></label>
            <label><span>保价金额</span><CurrencyInput aria-label="大宗保价金额" onValueChange={setDeclaredValueCents} valueCents={declaredValueCents} /></label>
            {paymentMethod === 'stamp' ? <label><span>贴票总金额</span><CurrencyInput aria-label="大宗贴票总金额" onValueChange={setStampAmountCents} valueCents={stampAmountCents} /></label> : null}
            {selectedProduct?.tariffKind === 'ordinary-parcel' ? (
              <label><span><b>*</b> 普包计费区</span><select aria-label="大宗普包计费区" onChange={(event) => setParcelTariffZone(event.target.value as ParcelTariffZone)} value={parcelTariffZone}><option value="">请选择</option>{['1', '2', '3', '4', '5', '6'].map((zone) => <option key={zone} value={zone}>{zone}区</option>)}</select></label>
            ) : null}
            {needsPlatformQuote ? <label><span><b>*</b> 寄递平台每件报价</span><CurrencyInput aria-label="大宗寄递平台每件报价" onValueChange={setPlatformQuoteCents} valueCents={platformQuoteCents} /></label> : null}
            <label className="bulk-contents-field"><span>内件名称</span><input aria-label="大宗公共内件名称" maxLength={60} onChange={(event) => setContents(event.target.value)} value={contents} /></label>
          </div>
          <div className="bulk-file-row">
            <label className="bulk-file-picker">
              <span>文件导入</span>
              <input accept=".xls" aria-label="大宗导入文件" onChange={(event) => setSourceFile(event.target.files?.[0] ?? null)} type="file" />
              <em>{sourceFile?.name ?? '未选择文件'}</em>
            </label>
            <button className="bulk-green-button" onClick={() => void importFile()} type="button">导入处理</button>
            <button className="bulk-blue-button" disabled={!customerReady} onClick={downloadTemplate} type="button">下载模板</button>
          </div>
        </section>

        <section className="bulk-section">
          <header><span>⌄</span><strong>查询处理</strong></header>
          <div className="bulk-query-row">
            <label><span>业务产品/批次</span><input aria-label="大宗查询批次" onChange={(event) => setQueryBatchId(event.target.value)} value={queryBatchId} /></label>
            <label><span>导入员工号</span><input aria-label="大宗查询员工" onChange={(event) => setQueryOperator(event.target.value)} value={queryOperator} /></label>
            <label><span>处理状态</span><select aria-label="大宗查询状态" onChange={(event) => setQueryStatus(event.target.value)} value={queryStatus}><option value="all">请选择</option><option value="unsettled">未结算</option><option value="settled">已结算</option><option value="failed">处理失败</option></select></label>
            <label><span>收寄日期</span><input aria-label="大宗查询开始日期" onChange={(event) => setQueryDateFrom(event.target.value)} type="date" value={queryDateFrom} /></label>
            <span className="bulk-date-separator">至</span>
            <label><span className="visually-hidden">结束日期</span><input aria-label="大宗查询结束日期" onChange={(event) => setQueryDateTo(event.target.value)} type="date" value={queryDateTo} /></label>
            <button className="bulk-blue-button" onClick={() => setAppliedQuery({ batchId: queryBatchId, operator: queryOperator, status: queryStatus, dateFrom: queryDateFrom, dateTo: queryDateTo })} type="button">查询</button>
          </div>
          <div className="bulk-table-wrap">
            <table className="bulk-table">
              <thead><tr><th>序号</th><th>处理状态</th><th>协议客户</th><th>总记录数</th><th>业务产品</th><th>导入员工</th><th>导入机构</th><th>打印要求</th><th>结算状态</th><th>操作</th></tr></thead>
              <tbody>
                {visibleBatches.map((batch, index) => {
                  const activeSealBags = activeBulkSealBags(serviceState, batch)
                  return <tr key={batch.id}>
                    <td>{index + 1}</td><td>{batchStatusLabel(batch)}</td><td>{batch.agreementAccountName}</td><td>{batch.totalCount}</td>
                    <td>{batch.product.searchCode} {batch.product.label}</td><td>{batch.operator.operatorId}</td><td>{batch.operator.workstationCode}</td>
                    <td>{printLabels[batch.printRequirement]}</td><td>{batch.settlementStatus === 'settled' ? '已结算' : '未结算'}</td>
                    <td className="bulk-actions">
                      <button onClick={() => { setDetailBatchId(batch.id); setDetailView('success') }} type="button">成功详情</button>
                      <button onClick={() => { setDetailBatchId(batch.id); setDetailView('processing') }} type="button">处理详细</button>
                      {batch.settlementStatus === 'unsettled' ? <button onClick={() => void settleBatch(batch)} type="button">结算</button> : null}
                      {batch.settlementStatus === 'settled' ? <button onClick={() => setLabelBatchId(batch.id)} type="button">打印</button> : null}
                      {batch.settlementStatus === 'settled' && batch.successCount >= batch.bulkThreshold ? <button onClick={() => { setPrintMode('reprint'); setPrintBatchId(batch.id) }} type="button">补打单据</button> : null}
                      {batch.settlementStatus === 'settled' && batch.documentPromptCompletedAt ? <button disabled={Boolean(batch.invoiceRegistration)} onClick={() => void openInvoice(batch)} type="button">{batch.invoiceRegistration ? '已开票' : '开票'}</button> : null}
                      {batch.product.searchCode === '303' && batch.settlementStatus === 'settled' && activeSealBags.length === 0 ? <button onClick={() => setSealBatchId(batch.id)} type="button">直封</button> : null}
                      {activeSealBags.length > 0 && batch.seal && (batch.seal.tagPrintDecision === null || batch.seal.tagPrintDecision === undefined) ? <button onClick={() => setSealTagBatchId(batch.id)} type="button">袋牌</button> : null}
                      {activeSealBags.length > 0 ? <span className="bulk-sealed-status">已直封 {activeSealBags.length} 袋</span> : null}
                    </td>
                  </tr>
                })}
                {visibleBatches.length === 0 ? <tr><td className="home-empty-cell" colSpan={10}>无数据</td></tr> : null}
              </tbody>
            </table>
          </div>
          <footer className="home-pagination"><button disabled type="button">‹</button><button aria-current="page" type="button">1</button><button disabled type="button">›</button><span>共 {visibleBatches.length} 条</span><select aria-label="大宗每页条数" defaultValue="20"><option value="20">20条/页</option></select></footer>
        </section>

        {message ? <p className="bulk-message" role="status">{message}</p> : null}
        {error ? <p className="bulk-error" role="alert">{error}</p> : null}
      </section>

      {customerDialogOpen ? (
        <Modal eyebrow="大宗收寄" title="寄件客户实名信息采集" wide>
          <form className="modal-form bulk-customer-form" onSubmit={(event) => void saveCustomer(event)}>
            <div className="bulk-customer-grid">
              <label><span><b>*</b> 协议客户</span><select aria-label="大宗协议客户" onChange={(event) => selectAccount(event.target.value)} value={accountId}><option value="">请选择协议客户</option>{customerState.agreementAccounts.map((account: AgreementAccount) => <option key={account.id} value={account.id}>{account.name} {account.id}</option>)}</select></label>
              <label><span><b>*</b> 联系电话</span><input aria-label="大宗寄件联系电话" onChange={(event) => { setSender({ ...sender, contact: event.target.value }); setCustomerErrors({}) }} value={sender.contact} /><FieldError message={customerErrors.contact} /></label>
              <label><span><b>*</b> 寄件人姓名</span><input aria-label="大宗寄件人姓名" onChange={(event) => setSender({ ...sender, name: event.target.value })} value={sender.name} /></label>
              <label><span><b>*</b> 身份证明类型</span><select aria-label="大宗身份证明类型" onChange={(event) => { setSender({ ...sender, identityType: event.target.value as SenderProfile['identityType'] }); setCustomerErrors({}) }} value={sender.identityType}><option value="">请选择</option><option value="primary">居民身份证</option><option value="temporary">临时身份证</option><option value="residence">居住证</option><option value="travel">其他旅行证件</option></select><FieldError message={customerErrors.identityType} /></label>
              <label><span><b>*</b> 身份证明号码</span><input aria-label="大宗身份证明号码" maxLength={20} onChange={(event) => { setSender({ ...sender, identityValue: event.target.value }); setCustomerErrors({}) }} value={sender.identityValue} /><FieldError message={customerErrors.identityValue} /></label>
              <label><span>性别</span><select aria-label="大宗寄件人性别" onChange={(event) => setSender({ ...sender, gender: event.target.value as SenderProfile['gender'] })} value={sender.gender}><option value="">请选择</option><option value="female">女</option><option value="male">男</option><option value="unspecified">未说明</option></select></label>
              <label className="bulk-customer-address"><span><b>*</b> 详细地址</span><input aria-label="大宗寄件详细地址" onChange={(event) => { setSender({ ...sender, detailedAddress: event.target.value }); setCustomerErrors({}) }} value={sender.detailedAddress} /><FieldError message={customerErrors.detailedAddress} /></label>
              <label><span>单位</span><input aria-label="大宗寄件单位" onChange={(event) => setSender({ ...sender, unit: event.target.value })} value={sender.unit} /></label>
              <label><span>邮编</span><input aria-label="大宗寄件邮编" inputMode="numeric" maxLength={6} onChange={(event) => { setSender({ ...sender, postalCode: event.target.value }); setCustomerErrors({}) }} value={sender.postalCode} /><FieldError message={customerErrors.postalCode} /></label>
            </div>
            <div className="bulk-customer-registration-actions">
              <button className="bulk-blue-button" onClick={() => { setRegistrationView('registration'); setRegistrationOpen(true) }} type="button">协议客户注册申请</button>
              <button className="bulk-blue-button" onClick={() => { setRegistrationView('query'); setRegistrationOpen(true) }} type="button">协议客户申请查询</button>
            </div>
            {customerErrors.form ? <p className="customer-form-error" role="alert">{customerErrors.form}</p> : null}
            {customerFormError ? <p className="customer-form-error" role="alert">{customerFormError}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => setCustomerDialogOpen(false)} type="button">取消</button><button className="primary-button" type="submit">确定</button></div>
          </form>
        </Modal>
      ) : null}

      {registrationOpen ? (
        <AgreementCustomerRegistrationModal
          customerRepository={customerRepository}
          customerState={customerState}
          initialView={registrationView}
          onApproved={selectApprovedAccount}
          onClose={() => setRegistrationOpen(false)}
          onStateChange={setCustomerState}
        />
      ) : null}

      {detailView && detailBatch ? (
        <Modal eyebrow="大宗导入" title={detailView === 'success' ? '邮件详情列表' : '处理提示'} wide>
          {detailView === 'success' ? (
            <div className="bulk-detail-modal">
              <div className="bulk-progress"><span style={{ width: `${detailBatch.progressPercent}%` }} /><strong>{detailBatch.progressPercent}%</strong></div>
              <p>100%时数据进入队列，点击查看邮件</p>
              <div className="bulk-table-wrap"><table className="bulk-table"><thead><tr><th>序号</th><th>邮件号码</th><th>用户自编号</th><th>寄达局</th><th>收件人</th><th>重量</th><th>资费</th></tr></thead><tbody>{detailBatch.rows.filter((row) => row.status === 'success').map((row) => <tr key={row.recordSequence}><td>{row.recordSequence}</td><td>{row.allocatedItemCode || '—'}</td><td>{row.customerSequence || '—'}</td><td>{row.destinationOfficeName}</td><td>{row.recipientName}</td><td>{row.resolvedWeightGrams}</td><td>{formatCents(row.postageCents)}</td></tr>)}</tbody></table></div>
              <div className="modal-actions"><button className="secondary-button" onClick={() => setDetailView(null)} type="button">取消</button>{detailBatch.settlementStatus === 'unsettled' && detailBatch.failedCount === 0 ? <button className="primary-button" onClick={() => void settleBatch(detailBatch)} type="button">结算</button> : null}</div>
            </div>
          ) : (
            <div className="bulk-detail-modal">
              <div className="bulk-metrics"><span>批次流水号：<b>{detailBatch.id}</b></span><span>处理总数：<b>{detailBatch.totalCount}</b></span><span>处理成功：<b>{detailBatch.successCount}</b></span><span>处理失败：<b>{detailBatch.failedCount}</b></span><span>处理成功总金额：<b>{formatCents(detailBatch.totalPostageCents)}</b></span></div>
              <div className="bulk-table-wrap"><table className="bulk-table"><thead><tr><th>序号</th><th>行数</th><th>邮件号码</th><th>错误原因</th></tr></thead><tbody>{detailBatch.rows.filter((row) => row.status === 'failed').map((row) => <tr key={row.recordSequence}><td>{row.recordSequence}</td><td>{row.recordSequence}</td><td>{row.itemCode}</td><td>{row.failureReason}</td></tr>)}{detailBatch.failedCount === 0 ? <tr><td className="home-empty-cell" colSpan={4}>无数据</td></tr> : null}</tbody></table></div>
              <div className="modal-actions bulk-detail-actions"><button className="secondary-button" onClick={() => setDetailView(null)} type="button">关闭</button>{detailBatch.failedCount > 0 ? <><button className="bulk-blue-button" onClick={() => downloadWorkbook(createBulkFailureWorkbook(detailBatch), `${detailBatch.id}-失败邮件.xls`)} type="button">导出失败邮件</button><button className="bulk-blue-button" onClick={() => downloadWorkbook(createBulkFailureWorkbook(detailBatch), `${detailBatch.id}-失败原因.xls`)} type="button">导出失败原因</button><button className="danger-button" onClick={() => void deleteBatch(detailBatch)} type="button">强制删除</button></> : detailBatch.settlementStatus === 'unsettled' ? <button className="primary-button" onClick={() => void settleBatch(detailBatch)} type="button">结算</button> : null}</div>
            </div>
          )}
        </Modal>
      ) : null}

      {printBatch ? (
        <BulkSettlementDocumentsModal
          batch={printBatch}
          mode={printMode}
          onClose={() => setPrintBatchId('')}
          onComplete={completeDocumentPrompt}
        />
      ) : null}

      {labelBatch ? (
        <BulkMailLabelPrintModal
          batch={labelBatch}
          onClose={() => setLabelBatchId('')}
          onComplete={completeLabelPrint}
        />
      ) : null}

      {invoiceBatch?.invoiceRequested === null ? (
        <Modal
          description={`批次 ${invoiceBatch.id} 已完成结算。`}
          eyebrow="结算完成"
          title="是否需要开具电子发票？"
        >
          <div className="modal-form invoice-choice">
            <p>请选择本批交易是否生成电子发票。</p>
            <div className="modal-actions"><button className="secondary-button" onClick={() => void chooseInvoice(false)} type="button">不需要</button><button className="primary-button primary-button--compact" onClick={() => void chooseInvoice(true)} type="button">需要</button></div>
          </div>
        </Modal>
      ) : null}

      {invoiceBatch?.invoiceRequested === true && !invoiceBatch.invoiceRegistration ? (
        <BulkInvoiceRegistrationModal
          batch={invoiceBatch}
          onClose={() => setInvoiceBatchId('')}
          onSubmit={submitInvoice}
        />
      ) : null}

      {invoiceBatch?.invoiceRegistration?.deliveryRequested === null ? (
        <Modal
          description={`电子发票已登记：${invoiceBatch.invoiceRegistration.buyerName}`}
          eyebrow="信息"
          title="是否进行发票交付？"
        >
          <div className="modal-form invoice-choice">
            <p>确认后记录本批电子发票交付结果。</p>
            <div className="modal-actions"><button className="secondary-button" onClick={() => void decideInvoiceDelivery(false)} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void decideInvoiceDelivery(true)} type="button">确定</button></div>
          </div>
        </Modal>
      ) : null}

      {sealBatch ? (
        <Modal eyebrow="爱心包裹" title="直封邮件">
          <form className="modal-form" onSubmit={(event) => void submitSeal(event)}>
            <div className="bulk-seal-grid"><label><span>封发种类</span><input readOnly value="爱心包裹" /></label><label><span><b>*</b> 封发班次</span><select aria-label="直封封发班次" onChange={(event) => setDispatchShift(event.target.value as DispatchBagShift)} value={dispatchShift}><option value="01">01</option><option value="02">02</option><option value="03">03</option></select></label><label><span>清单号码</span><input readOnly value="系统顺序生成" /></label><label><span><b>*</b> 容器种类</span><select aria-label="直封容器种类" onChange={(event) => setReceptacleType(event.target.value as '1.袋')} value={receptacleType}><option value="1.袋">1.袋</option></select></label><label><span><b>*</b> 每包数量</span><input aria-label="直封每包数量" min="1" onChange={(event) => setItemsPerBag(event.target.value)} type="number" value={itemsPerBag} /></label></div>
            <div className="modal-actions"><button className="secondary-button" onClick={() => setSealBatchId('')} type="button">取消</button><button className="primary-button" type="submit">确定</button></div>
          </form>
        </Modal>
      ) : null}

      {sealTagBatch ? (
        <Modal
          description={`批次 ${sealTagBatch.id} 已生成 ${sealTagBags.length} 个总包。`}
          eyebrow="信息"
          onClose={() => { setSealTagBatchId(''); setError('') }}
          title="总包生成成功！是否打印袋牌？"
          wide
        >
          <div className="modal-form bulk-bag-tag-prompt">
            <div className="bulk-bag-tag-sheets">
              {sealTagBags.map((bag) => (
                <article className="bulk-bag-tag" key={bag.id}>
                  <header><strong>爱心包裹袋牌</strong><span>{bag.shift} 班</span></header>
                  <p>{bag.bagBarcode}</p>
                  <dl><div><dt>清单</dt><dd>{bag.manifestNumber}</dd></div><div><dt>件数</dt><dd>{bag.totalItems}</dd></div><div><dt>接收局</dt><dd>{bag.receivingOfficeName}</dd></div></dl>
                </article>
              ))}
            </div>
            {error ? <p className="bulk-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setSealTagBatchId(''); setError('') }} type="button">关闭</button><button className="secondary-button" onClick={() => void decideSealTagPrint(false)} type="button">不打印</button><button className="primary-button primary-button--compact" onClick={() => void decideSealTagPrint(true)} type="button">打印</button></div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
