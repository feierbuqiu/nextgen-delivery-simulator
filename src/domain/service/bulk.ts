import { FICTIONAL_ADDRESSES } from '../customer/seed'
import { MINIMUM_BULK_ITEM_COUNT } from '../customer/agreement'
import type { SenderProfile } from '../customer/types'
import { INTERNATIONAL_DESTINATIONS } from './international'
import {
  calculateServiceCharge,
  effectiveBusinessCode,
  serviceItemCodeRule,
  validateServiceDraft,
  yuanToCents,
} from './policy'
import { createEmptyServiceDraft, SERVICE_PRODUCTS } from './seed'
import { syncBulkFiscalInvoice } from './invoiceManagement'
import { assertAccountingOpen } from './personalRemittance'
import {
  dispatchRelationForMail,
  dispatchRelationKey,
  executeMailSealingCommand,
  queryAvailableUnsealedMail,
} from './mailSealing'
import {
  assertServiceOperatorInstitution,
  serviceOperatorInstitutionCode,
} from './institutionScope'
import type {
  BulkBatch,
  BulkDocumentKind,
  BulkInvoiceBuyerType,
  BulkInvoiceRegistration,
  BulkNumberAllocation,
  BulkPrintRequirement,
  BulkProcessedRow,
  BulkSealRecord,
  BulkTemplateRow,
  DispatchBagShift,
  ParcelTariffZone,
  ServiceDestinationZone,
  ServiceOperatorSnapshot,
  ServicePaymentMethod,
  ServiceProduct,
  ServiceProductId,
  ServiceRemark,
  ServiceWorkspaceState,
} from './types'

export interface BulkCommonValues {
  remark: ServiceRemark
  remarkLabel: string
  weightGrams: number | null
  insuranceValueCents: number | null
  declaredValueCents: number | null
  stampAmountCents: number | null
  contents: string
  parcelTariffZone: ParcelTariffZone
  platformQuoteCents: number | null
}

export interface ImportBulkBatchRequest {
  importedAt: string
  acceptanceDate: string
  sourceFileName: string
  productId: ServiceProductId
  paymentMethod: ServicePaymentMethod
  printRequirement: BulkPrintRequirement
  numberAllocation: BulkNumberAllocation
  startingItemCode: string
  fallbackDestinationZone: Exclude<ServiceDestinationZone, ''>
  internationalDestinationCode: string
  agreementAccountId: string
  agreementAccountName: string
  sender: SenderProfile
  operator: ServiceOperatorSnapshot
  common: BulkCommonValues
  rows: BulkTemplateRow[]
}

export interface SealBulkBatchRequest {
  batchId: string
  sealedAt: string
  dispatchShift: DispatchBagShift
  receptacleType: '1.袋'
  itemsPerBag: number
  institutionCode: string
  operator: ServiceOperatorSnapshot
}

export interface RecordBulkMailLabelPrintRequest {
  batchId: string
  printedAt: string
  fromSequence: number
  toSequence: number
  detailSheet: boolean
}

export interface RecordBulkSealTagDecisionRequest {
  batchId: string
  print: boolean
  decidedAt: string
}

export interface RecordBulkDocumentPromptRequest {
  batchId: string
  documentKinds: BulkDocumentKind[]
  handledAt: string
  fromSequence: number
  toSequence: number
}

export interface RegisterBulkInvoiceRequest {
  batchId: string
  buyerType: BulkInvoiceBuyerType
  buyerName: string
  taxpayerId: string
  deliveryPhone: string
  buyerPhone: string
  deliveryEmail: string
  buyerAddress: string
  bankName: string
  bankAccount: string
  reviewer: string
  remark: string
  issuedAt: string
}

export interface RecordBulkInvoiceDeliveryRequest {
  batchId: string
  requested: boolean
  decidedAt: string
}

export const BULK_TEMPLATE_COLUMNS: ReadonlyArray<{
  key: keyof BulkTemplateRow
  label: string
  note: string
}> = [
  { key: 'recordSequence', label: '记录序号', note: '必填；从 1 开始连续编号。' },
  { key: 'customerSequence', label: '用户自编号', note: '选填；建议从 1 开始连续编号。' },
  { key: 'itemCode', label: '邮件号码', note: '自动分配时填写英文半角句点“.”；非自动分配时填写实际号码。' },
  { key: 'destinationPostcode', label: '寄达局邮编', note: '必填；国内可填“.”；国际可填 GJ 或实际邮编；最长 8 个字符。' },
  { key: 'destinationOfficeName', label: '寄达局名称', note: '必填；国内可填“.”；国际填写国家或地区首拼；最长 20 个汉字。' },
  { key: 'recipientName', label: '收件人姓名', note: '最长 20 个字符。' },
  { key: 'recipientAddress', label: '收件人地址', note: '须含省、市、县和详细地址；最长 120 个字符。' },
  { key: 'recipientPhone', label: '收件人电话', note: '必填；无法提供时填写英文半角句点“.”。' },
  { key: 'weightGrams', label: '重量', note: '单位为克，只允许整数；留空时使用界面公共值。' },
  { key: 'unitWeightGrams', label: '单件重量', note: '单位为克，只允许整数。' },
  { key: 'mailRemark', label: '邮件备注', note: '可逐件填写；留空时使用界面公共值。' },
  { key: 'contents', label: '内件名称', note: '最长 60 个字符或 30 个汉字。' },
  { key: 'contentsEnglish', label: '内件英文名', note: '最长 60 个字符。' },
  { key: 'countryEnglish', label: '境外区域英文标识', note: '境外演练数据使用；最长 30 个字符。' },
  { key: 'stateEnglish', label: '英文州名', note: '国际预报关使用；最长 50 个字符。' },
  { key: 'cityEnglish', label: '英文城市名', note: '国际预报关使用；最长 50 个字符。' },
  { key: 'senderNameEnglish', label: '寄件人姓名（英文）', note: '国际预报关使用。' },
  { key: 'senderProvinceEnglish', label: '寄件人省名（英文）', note: '最长 20 个字符。' },
  { key: 'senderCityEnglish', label: '寄件人城市名（英文）', note: '最长 100 个字符。' },
  { key: 'senderAddressEnglish', label: '寄件人地址（英文）', note: '最长 120 个字符。' },
  { key: 'senderPhone', label: '寄件人电话', note: '国际预报关使用。' },
  { key: 'contentsTypeCode', label: '内件类型代码', note: '国际预报关使用。' },
  { key: 'unitPriceUsd', label: '单价', note: '以美元计，只允许数字并最多保留两位小数。' },
  { key: 'agreementAccountId', label: '大客户编号', note: '只能填写完整客户编号，不得填写客户简码。' },
  { key: 'dispatchFlag', label: '封发标志', note: '必须留空，否则该邮件不参与封发。' },
  { key: 'affixedPostage', label: '已贴票金额', note: '选填；部分贴票时填写，最多两位小数。' },
]

export function bulkEligibleProducts(
  products: ServiceProduct[] = SERVICE_PRODUCTS,
): ServiceProduct[] {
  return products.filter(
    (product) => product.searchCode !== '301' && product.searchCode !== '307',
  )
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function xmlDecode(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function emptyTemplateRow(): BulkTemplateRow {
  return Object.fromEntries(
    BULK_TEMPLATE_COLUMNS.map((column) => [column.key, '']),
  ) as unknown as BulkTemplateRow
}

function sampleTemplateRows(agreementAccountId: string): BulkTemplateRow[] {
  const addresses = FICTIONAL_ADDRESSES.filter(
    (address) => address.mode === 'domestic' && address.zone === 'nonlocal',
  ).slice(0, 6)
  const recipientNames = ['顾远', '沈禾', '周岚', '许舟', '林岚', '周安']
  return addresses.map((address, index) => ({
    ...emptyTemplateRow(),
    recordSequence: String(index + 1),
    customerSequence: String(index + 1),
    itemCode: '.',
    destinationPostcode: '.',
    destinationOfficeName: '.',
    recipientName: recipientNames[index] ?? `演练收件人${index + 1}`,
    recipientAddress: address.detailedAddress,
    recipientPhone: `1880000010${index + 1}`,
    weightGrams: '20',
    unitWeightGrams: '20',
    agreementAccountId,
  }))
}

function workbookCell(value: string, style: string, note = ''): string {
  const comment = note
    ? `<Comment ss:Author="模拟器"><Data xmlns="http://www.w3.org/TR/REC-html40">${xmlEscape(note)}</Data></Comment>`
    : ''
  return `<Cell ss:StyleID="${style}"><Data ss:Type="String">${xmlEscape(value)}</Data>${comment}</Cell>`
}

export function createBulkTemplateWorkbook(agreementAccountId: string): string {
  const headers = BULK_TEMPLATE_COLUMNS.map((column) =>
    workbookCell(column.label, 'Header', column.note),
  ).join('')
  const rows = sampleTemplateRows(agreementAccountId).map((row) =>
    `<Row>${BULK_TEMPLATE_COLUMNS.map((column) => workbookCell(row[column.key], 'Body')).join('')}</Row>`,
  ).join('')
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="Body"><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
 </Styles>
 <Worksheet ss:Name="大宗导入"><Table ss:ExpandedColumnCount="${BULK_TEMPLATE_COLUMNS.length}" ss:ExpandedRowCount="${sampleTemplateRows(agreementAccountId).length + 1}" x:FullColumns="1" x:FullRows="1"><Row>${headers}</Row>${rows}</Table></Worksheet>
</Workbook>`
}

function parseSpreadsheetXml(source: string): string[][] {
  const rowMatches = source.match(/<Row\b[\s\S]*?<\/Row>/gi) ?? []
  return rowMatches.map((row) => {
    const cells: string[] = []
    const pattern = /<Cell\b([^>]*)>([\s\S]*?)<\/Cell>/gi
    let match: RegExpExecArray | null
    while ((match = pattern.exec(row))) {
      const indexMatch = /ss:Index="(\d+)"/i.exec(match[1] ?? '')
      if (indexMatch) {
        while (cells.length < Number(indexMatch[1]) - 1) cells.push('')
      }
      const data = /<Data\b[^>]*>([\s\S]*?)<\/Data>/i.exec(match[2] ?? '')
      let value = xmlDecode(data?.[1] ?? '')
      let previous = ''
      while (value !== previous) {
        previous = value
        value = value.replace(/<[^>]*>/gu, '')
      }
      cells.push(value.replaceAll('<', '').replaceAll('>', '').trim())
    }
    return cells
  })
}

function parseDelimited(source: string): string[][] {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (lines.length === 0) return []
  const delimiter = lines[0]!.includes('\t') ? '\t' : ','
  return lines.map((line) => {
    const cells: string[] = []
    let value = ''
    let quoted = false
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index]!
      if (character === '"') {
        if (quoted && line[index + 1] === '"') {
          value += '"'
          index += 1
        } else {
          quoted = !quoted
        }
      } else if (character === delimiter && !quoted) {
        cells.push(value.trim())
        value = ''
      } else {
        value += character
      }
    }
    cells.push(value.trim())
    return cells
  })
}

export function parseBulkTemplate(source: string): BulkTemplateRow[] {
  if (!source.trim() || source.includes('\u0000')) {
    throw new Error('所选 .xls 文件不是本页模板可读取的格式。')
  }
  const table = /<Workbook\b|<Worksheet\b/i.test(source)
    ? parseSpreadsheetXml(source)
    : parseDelimited(source)
  if (table.length < 2) throw new Error('导入模板中没有可处理的数据行。')
  const header = table[0]!.map((value) => value.trim())
  const indexes = new Map(header.map((label, index) => [label, index]))
  const missing = BULK_TEMPLATE_COLUMNS.filter((column) => !indexes.has(column.label))
  if (missing.length > 0) {
    throw new Error(`导入模板字段不完整：${missing.map((column) => column.label).join('、')}。`)
  }
  return table.slice(1).filter((cells) => cells.some((value) => value.trim())).map((cells) =>
    Object.fromEntries(BULK_TEMPLATE_COLUMNS.map((column) => [
      column.key,
      cells[indexes.get(column.label)!]?.trim() ?? '',
    ])) as unknown as BulkTemplateRow,
  )
}

function parseInteger(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : null
}

function parseCurrency(value: string): number | null {
  const normalized = value.trim()
  if (!normalized) return null
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null
  try {
    return yuanToCents(normalized)
  } catch {
    return null
  }
}

function incrementNumeric(value: string, offset: number): string | null {
  if (!/^\d+$/.test(value)) return null
  const next = BigInt(value) + BigInt(offset)
  const result = next.toString().padStart(value.length, '0')
  return result.length === value.length ? result : null
}

function s10CheckDigit(serial: string): string {
  const weights = [8, 6, 4, 2, 3, 5, 9, 7]
  const total = serial.split('').reduce(
    (sum, digit, index) => sum + Number(digit) * weights[index]!,
    0,
  )
  const raw = 11 - (total % 11)
  return String(raw === 10 ? 0 : raw === 11 ? 5 : raw)
}

function allocateItemCode(
  product: ServiceProduct,
  zone: ServiceDestinationZone,
  startingItemCode: string,
  offset: number,
): string | null {
  const rule = serviceItemCodeRule(product, zone)
  const start = startingItemCode.trim().toUpperCase()
  if (rule === 'none') return ''
  if (rule === 'seven-prefix-13-digits' || rule === 'express-domestic-12') {
    return incrementNumeric(start, offset)
  }
  if (rule === 'registered-domestic-13' || rule === 'parcel-domestic-13') {
    const match = /^([A-Z]{2})(\d{11})$/.exec(start)
    const number = match ? incrementNumeric(match[2]!, offset) : null
    return match && number ? `${match[1]}${number}` : null
  }
  if (rule === 'standard-express-13') {
    const match = /^89(\d{8})X99$/.exec(start)
    const number = match ? incrementNumeric(match[1]!, offset) : null
    return match && number ? `89${number}X99` : null
  }
  const match = /^([A-Z]{2})(\d{8})\d([A-Z]{2})$/.exec(start)
  const serial = match ? incrementNumeric(match[2]!, offset) : null
  return match && serial
    ? `${match[1]}${serial}${s10CheckDigit(serial)}${match[3]}`
    : null
}

function inferDestinationZone(
  row: BulkTemplateRow,
  fallback: Exclude<ServiceDestinationZone, ''>,
): Exclude<ServiceDestinationZone, ''> {
  if (
    row.destinationPostcode.trim().toUpperCase() === 'GJ' ||
    row.countryEnglish.trim()
  ) return 'international'
  const address = row.recipientAddress.trim()
  const matched = FICTIONAL_ADDRESSES.find((candidate) =>
    candidate.mode === 'domestic' && candidate.hierarchy.some((part) => address.includes(part)),
  )
  return matched?.zone ?? fallback
}

function remarkFromText(
  product: ServiceProduct,
  rowRemark: string,
  fallback: ServiceRemark,
): ServiceRemark {
  const normalized = rowRemark.trim().toUpperCase()
  const mapped: Partial<Record<string, ServiceRemark>> = {
    PX: 'ordinary-letter',
    平信: 'ordinary-letter',
    MXP: 'postcard',
    明信片: 'postcard',
    人民来信: 'people-letter',
    文: 'document',
    物: 'goods',
  }
  const candidate = mapped[normalized] ?? fallback
  if (product.remarkOptions.length === 0) return candidate
  return product.remarkOptions.includes(candidate)
    ? candidate
    : fallback
}

function textLength(value: string): number {
  return Array.from(value.trim()).length
}

function rowStructuralErrors(
  row: BulkTemplateRow,
  index: number,
  request: ImportBulkBatchRequest,
): string[] {
  const errors: string[] = []
  if (row.recordSequence !== String(index + 1)) errors.push('记录序号必须从 1 开始连续编号')
  if (!row.destinationPostcode) errors.push('寄达局邮编不能为空')
  if (textLength(row.destinationPostcode) > 8) errors.push('寄达局邮编不得超过 8 个字符')
  if (!row.destinationOfficeName) errors.push('寄达局名称不能为空')
  if (textLength(row.destinationOfficeName) > 20) errors.push('寄达局名称不得超过 20 个汉字')
  if (!row.recipientAddress) errors.push('收件人地址不能为空')
  if (textLength(row.recipientAddress) > 120) errors.push('收件人地址不得超过 120 个字符')
  if (textLength(row.recipientName) > 20) errors.push('收件人姓名不得超过 20 个字符')
  if (!row.recipientPhone) errors.push('收件人电话不能为空；无法提供时填写“.”')
  if (row.dispatchFlag) errors.push('封发标志必须留空')
  if (
    row.agreementAccountId &&
    row.agreementAccountId !== request.agreementAccountId
  ) errors.push('大客户编号必须填写当前协议客户的完整编号')
  if (row.unitWeightGrams && parseInteger(row.unitWeightGrams) === null) {
    errors.push('单件重量必须为整数克数')
  }
  if (textLength(row.contents) > 60) errors.push('内件名称不得超过 60 个字符')
  if (textLength(row.contentsEnglish) > 60) errors.push('内件英文名不得超过 60 个字符')
  if (textLength(row.countryEnglish) > 30) errors.push('英文国家名不得超过 30 个字符')
  if (textLength(row.stateEnglish) > 50) errors.push('英文州名不得超过 50 个字符')
  if (textLength(row.cityEnglish) > 50) errors.push('英文城市名不得超过 50 个字符')
  if (textLength(row.senderProvinceEnglish) > 20) errors.push('寄件人英文省名不得超过 20 个字符')
  if (textLength(row.senderCityEnglish) > 100) errors.push('寄件人英文城市名不得超过 100 个字符')
  if (textLength(row.senderAddressEnglish) > 120) errors.push('寄件人英文地址不得超过 120 个字符')
  if (row.unitPriceUsd && parseCurrency(row.unitPriceUsd) === null) {
    errors.push('单价必须为最多保留两位小数的数值')
  }
  if (row.affixedPostage && parseCurrency(row.affixedPostage) === null) {
    errors.push('已贴票金额必须为最多保留两位小数的数值')
  }
  if (request.numberAllocation === 'automatic' && row.itemCode !== '.') {
    errors.push('自动分配邮件号码时模板邮件号码栏必须填写“.”')
  }
  if (request.numberAllocation === 'manual' && (!row.itemCode || row.itemCode === '.')) {
    errors.push('非自动分配时必须逐件填写邮件号码')
  }
  if (/POLAR[- ]DEMO|寒原演练区/i.test(row.countryEnglish)) {
    const customsFields = [
      row.recipientName,
      row.recipientAddress,
      row.recipientPhone,
      row.itemCode,
      row.countryEnglish,
      row.stateEnglish,
      row.cityEnglish,
      row.senderNameEnglish,
      row.senderProvinceEnglish,
      row.senderCityEnglish,
      row.senderAddressEnglish,
      row.senderPhone,
      row.contentsTypeCode,
    ]
    if (customsFields.some((value) => !value.trim())) {
      errors.push('寄往寒原演练区的邮件必须完整填写预报关字段')
    }
  }
  return errors
}

function failedRow(
  row: BulkTemplateRow,
  reason: string,
  zone: ServiceDestinationZone = '',
  effectiveCode = '',
): BulkProcessedRow {
  return {
    ...row,
    status: 'failed',
    failureReason: reason,
    allocatedItemCode: '',
    destinationZone: zone,
    effectiveBusinessCode: effectiveCode,
    resolvedWeightGrams: null,
    postageCents: 0,
    settlementDueCents: 0,
  }
}

function batchId(acceptanceDate: string, sequence: number): string {
  return `DZ-${acceptanceDate.replaceAll('-', '')}-${String(sequence).padStart(6, '0')}`
}

function historicalItemCodes(state: ServiceWorkspaceState): Set<string> {
  return new Set([
    ...state.transactions.map((transaction) => transaction.service.itemCode.trim().toUpperCase()),
    ...state.bulkBatches.flatMap((batch) => batch.rows.map((row) => (
      row.allocatedItemCode.trim().toUpperCase()
    ))),
  ].filter(Boolean))
}

export function importBulkBatch(
  state: ServiceWorkspaceState,
  request: ImportBulkBatchRequest,
): { state: ServiceWorkspaceState; batch: BulkBatch } {
  assertAccountingOpen(state, request.operator, request.importedAt)
  const product = SERVICE_PRODUCTS.find((candidate) => candidate.id === request.productId)
  if (!product || !bulkEligibleProducts().some((candidate) => candidate.id === product.id)) {
    throw new Error('请选择允许大宗导入的业务产品。')
  }
  if (!request.agreementAccountId || !request.sender.identityValue.trim()) {
    throw new Error('请先完成协议客户和寄件人实名信息采集。')
  }
  if (request.rows.length === 0) throw new Error('导入模板中没有可处理的数据行。')
  if (request.rows.length < MINIMUM_BULK_ITEM_COUNT) {
    throw new Error(`大宗收寄每批至少需要 ${MINIMUM_BULK_ITEM_COUNT} 件邮件。`)
  }
  if (request.numberAllocation === 'automatic' &&
    serviceItemCodeRule(product, request.fallbackDestinationZone) !== 'none' &&
    !request.startingItemCode.trim()) {
    throw new Error('自动分配邮件号码时必须输入邮件号码起号。')
  }

  const usedItemCodes = new Set<string>()
  const historicalCodes = historicalItemCodes(state)
  const rows = request.rows.map((row, index): BulkProcessedRow => {
    const structural = rowStructuralErrors(row, index, request)
    const zone = inferDestinationZone(row, request.fallbackDestinationZone)
    const effectiveCode = effectiveBusinessCode(product, zone)
    if (structural.length > 0) return failedRow(row, structural.join('；'), zone, effectiveCode)
    const weight = parseInteger(row.weightGrams) ?? request.common.weightGrams
    if (weight === null) return failedRow(row, '重量不能为空，且必须为整数克数', zone, effectiveCode)

    const allocated = request.numberAllocation === 'automatic'
      ? allocateItemCode(product, zone, request.startingItemCode, index)
      : row.itemCode.trim().toUpperCase()
    if (allocated === null) {
      return failedRow(row, '邮件号码起号与当前业务号码规则不匹配', zone, effectiveCode)
    }
    if (allocated && usedItemCodes.has(allocated)) {
      return failedRow(row, '邮件号码在本批次内重复', zone, effectiveCode)
    }
    if (allocated && historicalCodes.has(allocated)) {
      return failedRow(row, '邮件号码已在历史收寄记录中使用', zone, effectiveCode)
    }
    if (allocated) usedItemCodes.add(allocated)

    const internationalDestination = INTERNATIONAL_DESTINATIONS.find(
      (destination) => destination.code === request.internationalDestinationCode,
    )
    const remark = remarkFromText(product, row.mailRemark, request.common.remark)
    const draft = {
      ...createEmptyServiceDraft(true, zone),
      productId: product.id,
      destinationOffice: zone === 'international'
        ? internationalDestination?.code ?? ''
        : row.destinationOfficeName === '.' ? '' : row.destinationOfficeName,
      itemCode: allocated,
      remark,
      weightGrams: weight,
      paymentMethod: request.paymentMethod,
      stampAmountCents: parseCurrency(row.affixedPostage) ?? request.common.stampAmountCents,
      declaredValueCents: request.common.declaredValueCents,
      insuranceValueCents: request.common.insuranceValueCents,
      contents: row.contents || request.common.contents,
      parcelTariffZone: request.common.parcelTariffZone,
      platformQuoteCents: request.common.platformQuoteCents,
      operatorNote: `大宗批次 ${request.acceptanceDate}`,
    }
    const validation = validateServiceDraft(draft, SERVICE_PRODUCTS, true)
    if (!validation.valid) {
      return failedRow(
        row,
        [...new Set(Object.values(validation.errors))].join('；'),
        zone,
        effectiveCode,
      )
    }
    const charge = calculateServiceCharge(draft, product)
    return {
      ...row,
      mailRemark: row.mailRemark || request.common.remarkLabel,
      status: 'success',
      failureReason: '',
      allocatedItemCode: allocated,
      destinationZone: zone,
      effectiveBusinessCode: effectiveCode,
      resolvedWeightGrams: weight,
      postageCents: charge.postageCents,
      settlementDueCents: charge.settlementDueCents,
    }
  })
  const successRows = rows.filter((row) => row.status === 'success')
  const batch: BulkBatch = {
    id: batchId(request.acceptanceDate, state.nextBulkBatchSequence),
    importedAt: request.importedAt,
    acceptanceDate: request.acceptanceDate,
    sourceFileName: request.sourceFileName,
    product: {
      id: product.id,
      label: product.label,
      searchCode: product.searchCode,
      effectiveBusinessCode: product.searchCode,
    },
    paymentMethod: request.paymentMethod,
    printRequirement: request.printRequirement,
    numberAllocation: request.numberAllocation,
    treatmentType: 'full-no-detail',
    agreementAccountId: request.agreementAccountId,
    agreementAccountName: request.agreementAccountName,
    commonRemarkLabel: request.common.remarkLabel,
    sender: structuredClone(request.sender),
    operator: structuredClone(request.operator),
    rows,
    totalCount: rows.length,
    successCount: successRows.length,
    failedCount: rows.length - successRows.length,
    totalPostageCents: successRows.reduce((total, row) => total + row.postageCents, 0),
    totalSettlementDueCents: successRows.reduce(
      (total, row) => total + row.settlementDueCents,
      0,
    ),
    progressPercent: 100,
    settlementStatus: 'unsettled',
    settledAt: null,
    bulkThreshold: MINIMUM_BULK_ITEM_COUNT,
    couponCount: 0,
    couponDiscountCents: 0,
    documentPromptCompletedAt: null,
    documentPrintRecords: [],
    mailLabelPrintRecords: [],
    invoiceRequested: null,
    invoiceRegistration: null,
    seal: null,
  }
  return {
    batch,
    state: {
      ...state,
      bulkBatches: [...state.bulkBatches, batch],
      nextBulkBatchSequence: state.nextBulkBatchSequence + 1,
    },
  }
}

export function settleBulkBatch(
  state: ServiceWorkspaceState,
  id: string,
  settledAt: string,
): { state: ServiceWorkspaceState; batch: BulkBatch } {
  const target = state.bulkBatches.find((batch) => batch.id === id)
  if (!target) throw new Error('未找到大宗导入批次。')
  assertAccountingOpen(state, target.operator, settledAt)
  if (target.settlementStatus === 'settled') throw new Error('该批次已经结算。')
  if (target.successCount === 0) throw new Error('该批次没有可结算的成功邮件。')
  if (target.failedCount > 0) throw new Error('请先修正并重新导入全部失败邮件，再进行结算。')
  const batch: BulkBatch = {
    ...target,
    settlementStatus: 'settled',
    settledAt,
  }
  return {
    batch,
    state: {
      ...state,
      bulkBatches: state.bulkBatches.map((item) => item.id === id ? batch : item),
    },
  }
}

function replaceBulkBatch(
  state: ServiceWorkspaceState,
  batch: BulkBatch,
): { state: ServiceWorkspaceState; batch: BulkBatch } {
  return {
    batch,
    state: {
      ...state,
      bulkBatches: state.bulkBatches.map((item) => item.id === batch.id ? batch : item),
    },
  }
}

function settledBulkBatch(state: ServiceWorkspaceState, id: string): BulkBatch {
  const target = state.bulkBatches.find((batch) => batch.id === id)
  if (!target) throw new Error('未找到大宗导入批次。')
  if (target.settlementStatus !== 'settled') throw new Error('请先完成大宗批次结算。')
  return target
}

export function recordBulkDocumentPrompt(
  state: ServiceWorkspaceState,
  request: RecordBulkDocumentPromptRequest,
): { state: ServiceWorkspaceState; batch: BulkBatch } {
  const target = settledBulkBatch(state, request.batchId)
  if (target.successCount < target.bulkThreshold) {
    throw new Error(`收寄件数未达到 ${target.bulkThreshold} 件大宗单据标准。`)
  }
  if (
    !Number.isInteger(request.fromSequence) ||
    !Number.isInteger(request.toSequence) ||
    request.fromSequence < 1 ||
    request.toSequence < request.fromSequence ||
    request.toSequence > target.successCount
  ) {
    throw new Error('打印起止序号超出本批成功邮件范围。')
  }
  const allowedKinds = new Set<BulkDocumentKind>([
    'bulk-mailing-list',
    'consolidated-posting-summary',
  ])
  const documentKinds = [...new Set(request.documentKinds)]
  if (documentKinds.some((kind) => !allowedKinds.has(kind))) {
    throw new Error('所选大宗单据类型无效。')
  }
  const batch: BulkBatch = {
    ...target,
    documentPromptCompletedAt: target.documentPromptCompletedAt ?? request.handledAt,
    documentPrintRecords: [
      ...target.documentPrintRecords,
      ...documentKinds.map((kind) => ({
        kind,
        printedAt: request.handledAt,
        fromSequence: request.fromSequence,
        toSequence: request.toSequence,
      })),
    ],
  }
  return replaceBulkBatch(state, batch)
}

export function recordBulkMailLabelPrint(
  state: ServiceWorkspaceState,
  request: RecordBulkMailLabelPrintRequest,
): { state: ServiceWorkspaceState; batch: BulkBatch } {
  const target = settledBulkBatch(state, request.batchId)
  if (
    !Number.isInteger(request.fromSequence) ||
    !Number.isInteger(request.toSequence) ||
    request.fromSequence < 1 ||
    request.toSequence < request.fromSequence ||
    request.toSequence > target.successCount
  ) {
    throw new Error('面单打印起止序号超出本批成功邮件范围。')
  }
  const batch: BulkBatch = {
    ...target,
    mailLabelPrintRecords: [
      ...(target.mailLabelPrintRecords ?? []),
      {
        printedAt: request.printedAt,
        fromSequence: request.fromSequence,
        toSequence: request.toSequence,
        detailSheet: request.detailSheet,
      },
    ],
  }
  return replaceBulkBatch(state, batch)
}

export function recordBulkInvoiceChoice(
  state: ServiceWorkspaceState,
  batchIdValue: string,
  requested: boolean,
): { state: ServiceWorkspaceState; batch: BulkBatch } {
  const target = settledBulkBatch(state, batchIdValue)
  if (!target.documentPromptCompletedAt) {
    throw new Error('请先处理大宗单据打印提示。')
  }
  if (!requested && target.invoiceRegistration) {
    throw new Error('电子发票已经登记，不能改为不需要。')
  }
  const batch: BulkBatch = {
    ...target,
    invoiceRequested: requested,
    invoiceRegistration: requested ? target.invoiceRegistration : null,
  }
  return replaceBulkBatch(state, batch)
}

export function registerBulkInvoice(
  state: ServiceWorkspaceState,
  request: RegisterBulkInvoiceRequest,
): { state: ServiceWorkspaceState; batch: BulkBatch } {
  const target = settledBulkBatch(state, request.batchId)
  if (target.invoiceRequested !== true) throw new Error('请先选择需要电子发票。')
  if (!request.buyerName.trim()) throw new Error('购方名称不能为空。')
  if (!request.taxpayerId.trim()) throw new Error('购方纳税人识别号不能为空。')
  if (!request.deliveryPhone.trim() && !request.deliveryEmail.trim()) {
    throw new Error('交付电话和交付邮箱至少填写一项。')
  }
  const invoiceRegistration: BulkInvoiceRegistration = {
    buyerType: request.buyerType,
    buyerName: request.buyerName.trim(),
    taxpayerId: request.taxpayerId.trim(),
    deliveryPhone: request.deliveryPhone.trim(),
    buyerPhone: request.buyerPhone.trim(),
    deliveryEmail: request.deliveryEmail.trim(),
    buyerAddress: request.buyerAddress.trim(),
    bankName: request.bankName.trim(),
    bankAccount: request.bankAccount.trim(),
    reviewer: request.reviewer.trim(),
    remark: request.remark.trim(),
    issuedAt: request.issuedAt,
    deliveryRequested: null,
    deliveredAt: null,
  }
  const replaced = replaceBulkBatch(state, { ...target, invoiceRegistration })
  return {
    batch: replaced.batch,
    state: syncBulkFiscalInvoice(replaced.state, replaced.batch),
  }
}

export function recordBulkInvoiceDelivery(
  state: ServiceWorkspaceState,
  request: RecordBulkInvoiceDeliveryRequest,
): { state: ServiceWorkspaceState; batch: BulkBatch } {
  const target = settledBulkBatch(state, request.batchId)
  if (!target.invoiceRegistration) throw new Error('尚未登记电子发票。')
  const invoiceRegistration: BulkInvoiceRegistration = {
    ...target.invoiceRegistration,
    deliveryRequested: request.requested,
    deliveredAt: request.requested ? request.decidedAt : null,
  }
  const replaced = replaceBulkBatch(state, { ...target, invoiceRegistration })
  return {
    batch: replaced.batch,
    state: syncBulkFiscalInvoice(replaced.state, replaced.batch),
  }
}

export function deleteBulkBatch(
  state: ServiceWorkspaceState,
  id: string,
): ServiceWorkspaceState {
  const target = state.bulkBatches.find((batch) => batch.id === id)
  if (!target) throw new Error('未找到大宗导入批次。')
  if (target.settlementStatus === 'settled') {
    throw new Error('已结算批次不能在大宗处理删除，请先按业务查改流程处理。')
  }
  return {
    ...state,
    bulkBatches: state.bulkBatches.filter((batch) => batch.id !== id),
  }
}

export function sealBulkBatch(
  state: ServiceWorkspaceState,
  request: SealBulkBatchRequest,
): { state: ServiceWorkspaceState; batch: BulkBatch } {
  const target = state.bulkBatches.find((batch) => batch.id === request.batchId)
  if (!target) throw new Error('未找到大宗导入批次。')
  if (target.product.searchCode !== '303') throw new Error('当前仅爱心包裹批次提供直封操作。')
  if (target.settlementStatus !== 'settled') throw new Error('请先结算后封发。')
  if (activeBulkSealBags(state, target).length > 0) {
    throw new Error('该爱心包裹批次已经完成直封。')
  }
  if (!['01', '02', '03'].includes(request.dispatchShift) || request.receptacleType !== '1.袋') {
    throw new Error('请选择有效的封发班次和容器种类。')
  }
  if (!Number.isInteger(request.itemsPerBag) || request.itemsPerBag < 1) {
    throw new Error('每包数量必须为大于 0 的整数。')
  }
  if (!request.institutionCode.trim()) throw new Error('当前机构代码不能为空。')
  const institutionCode = assertServiceOperatorInstitution(
    request.operator,
    request.institutionCode,
  )

  const available = queryAvailableUnsealedMail(state, institutionCode).filter((item) => (
    item.reference.kind === 'bulk-row' && item.reference.batchId === target.id
  ))
  if (available.length !== target.successCount) {
    throw new Error('该批次已有邮件进入其他总包，不能再次整批直封。')
  }
  const groups = new Map<string, typeof available>()
  for (const item of available) {
    const relation = dispatchRelationForMail(item, state.dispatchRelationOverrides)
    if (!relation) throw new Error('爱心包裹封发关系未配置，不能直封。')
    const key = dispatchRelationKey(relation)
    const current = groups.get(key) ?? []
    current.push(item)
    groups.set(key, current)
  }

  let manifestSequence = state.nextDispatchManifestSequence
  const manifests = [...groups.values()].flatMap((items) => {
    const chunks = Array.from(
      { length: Math.ceil(items.length / request.itemsPerBag) },
      (_, index) => items.slice(
        index * request.itemsPerBag,
        (index + 1) * request.itemsPerBag,
      ),
    )
    return chunks.map((chunk) => {
      if (manifestSequence > 999) throw new Error('清单号码已超出三位编号范围。')
      const manifestNumber = String(manifestSequence).padStart(3, '0')
      manifestSequence += 1
      return {
        mailReferences: chunk.map((item) => item.reference),
        manifestNumber,
        receptacleType: request.receptacleType,
        usesBarcodeContainer: false,
        containerBarcode: '',
        rfidBagTagNumber: '',
      }
    })
  })
  const generated = executeMailSealingCommand(state, {
    type: 'generate-dispatch-bags',
    manifests,
    shift: request.dispatchShift,
    institutionCode,
    generatedAt: request.sealedAt,
    operator: request.operator,
  })
  const seal: BulkSealRecord = {
    sealedAt: request.sealedAt,
    dispatchShift: request.dispatchShift,
    receptacleType: request.receptacleType,
    itemsPerBag: request.itemsPerBag,
    bagIds: generated.bags.map((bag) => bag.id),
    bagBarcodes: generated.bags.map((bag) => bag.bagBarcode),
    tagPrintDecision: null,
    tagPrintedAt: null,
  }
  const batch: BulkBatch = { ...target, seal }
  return {
    batch,
    state: {
      ...generated.state,
      bulkBatches: generated.state.bulkBatches.map((item) =>
        item.id === request.batchId ? batch : item,
      ),
    },
  }
}

export function recordBulkSealTagDecision(
  state: ServiceWorkspaceState,
  request: RecordBulkSealTagDecisionRequest,
): { state: ServiceWorkspaceState; batch: BulkBatch } {
  const target = settledBulkBatch(state, request.batchId)
  if (!target.seal) throw new Error('请先完成爱心包裹直封。')
  const bagIds = target.seal.bagIds ?? []
  if (bagIds.length === 0) throw new Error('旧版直封记录未生成统一总包，不能登记袋牌打印。')
  const activeBagIds = activeBulkSealBags(state, target).map((bag) => bag.id)
  if (activeBagIds.length === 0) throw new Error('当前直封总包均已撤销，不能登记袋牌打印。')
  if (target.seal.tagPrintDecision !== null && target.seal.tagPrintDecision !== undefined) {
    throw new Error('该批次已经记录袋牌打印决定。')
  }
  const decided = executeMailSealingCommand(state, {
    type: 'record-dispatch-bag-tag-decision',
    bagIds: activeBagIds,
    print: request.print,
    decidedAt: request.decidedAt,
    institutionCode: serviceOperatorInstitutionCode(target.operator),
  })
  const batch: BulkBatch = {
    ...target,
    seal: {
      ...target.seal,
      tagPrintDecision: request.print ? 'printed' : 'skipped',
      tagPrintedAt: request.print ? request.decidedAt : null,
    },
  }
  return {
    batch,
    state: {
      ...decided.state,
      bulkBatches: decided.state.bulkBatches.map((item) => (
        item.id === target.id ? batch : item
      )),
    },
  }
}

export function activeBulkSealBags(state: ServiceWorkspaceState, batch: BulkBatch) {
  const bagIds = new Set(batch.seal?.bagIds ?? [])
  return state.dispatchBags.filter((bag) => (
    bagIds.has(bag.id) && bag.sealingStatus === 'sealed'
  ))
}

export function createBulkFailureWorkbook(batch: BulkBatch): string {
  const failed = batch.rows.filter((row) => row.status === 'failed')
  const headers = [
    ...BULK_TEMPLATE_COLUMNS.map((column) => workbookCell(column.label, 'Header', column.note)),
    workbookCell('失败原因', 'Header'),
  ].join('')
  const rows = failed.map((row) => `<Row>${[
    ...BULK_TEMPLATE_COLUMNS.map((column) => workbookCell(row[column.key], 'Body')),
    workbookCell(row.failureReason, 'Body'),
  ].join('')}</Row>`).join('')
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1"/></Style><Style ss:ID="Body"/></Styles><Worksheet ss:Name="失败邮件"><Table ss:ExpandedColumnCount="${BULK_TEMPLATE_COLUMNS.length + 1}" ss:ExpandedRowCount="${failed.length + 1}" x:FullColumns="1" x:FullRows="1"><Row>${headers}</Row>${rows}</Table></Worksheet></Workbook>`
}
