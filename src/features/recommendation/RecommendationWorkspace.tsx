import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { validateSender, type CustomerErrors } from '../../domain/customer/policy'
import type { CustomerRepository } from '../../domain/customer/repository'
import {
  createEmptyRecipient,
  createEmptySender,
  FICTIONAL_ADDRESSES,
} from '../../domain/customer/seed'
import type {
  CustomerDraft,
  CustomerWorkspaceState,
  FictionalAddress,
  SenderProfile,
} from '../../domain/customer/types'
import { INTERNATIONAL_DESTINATIONS } from '../../domain/service/international'
import {
  createRecommendationTransfer,
  recommendServiceProducts,
  type RecommendationCriteria,
  type RecommendationMailType,
  type ServiceRecommendation,
  type ServiceRecommendationTransfer,
} from '../../domain/service/recommendation'
import { formatCents } from '../../domain/service/policy'
import { SERVICE_PRODUCTS } from '../../domain/service/seed'
import type { ServiceDestinationZone } from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

interface RecommendationWorkspaceProps {
  repository: CustomerRepository
  onBack: () => void
  onSelect: (selection: ServiceRecommendationTransfer) => void
}

interface DestinationChoice {
  id: string
  label: string
  zone: Exclude<ServiceDestinationZone, ''>
  office: string
}

function compactHierarchy(address: FictionalAddress): string {
  return address.hierarchy
    .filter((part, index, hierarchy) => part && part !== hierarchy[index - 1])
    .join(' / ')
}

function uniqueDestinationChoices(): DestinationChoice[] {
  const choices = FICTIONAL_ADDRESSES
    .filter((address) => address.mode === 'domestic')
    .map((address) => ({
      id: `address:${address.id}`,
      label: compactHierarchy(address),
      zone: address.zone,
      office: address.hierarchy.at(-1) ?? '',
    }))
  const seen = new Set<string>()
  const uniqueDomestic = choices.filter((choice) => {
    const key = `${choice.zone}:${choice.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const international = INTERNATIONAL_DESTINATIONS.map((destination) => ({
    id: `international:${destination.code}`,
    label: destination.label,
    zone: 'international' as const,
    office: destination.code,
  }))
  return [...uniqueDomestic, ...international]
}

function FieldError({ message }: { message?: string }) {
  return message ? <span className="customer-field-error">{message}</span> : null
}

function RecommendationBreadcrumb({ onBack }: { onBack: () => void }) {
  return <div className="customer-breadcrumb">
    <button onClick={onBack} type="button">首页</button>
    <span>/</span><span>业务办理</span><span>/</span><strong>业务推荐</strong>
  </div>
}

function remarkLabel(recommendation: ServiceRecommendation): string {
  if (recommendation.remark === 'document') return '文'
  if (recommendation.remark === 'goods') return '物'
  return '无'
}

export function RecommendationWorkspace({
  repository,
  onBack,
  onSelect,
}: RecommendationWorkspaceProps) {
  const [workspace, setWorkspace] = useState<CustomerWorkspaceState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [customerDialogOpen, setCustomerDialogOpen] = useState(true)
  const [sender, setSender] = useState<SenderProfile>(createEmptySender)
  const [senderErrors, setSenderErrors] = useState<CustomerErrors>({})
  const [saveError, setSaveError] = useState('')
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [senderAddressId, setSenderAddressId] = useState('')
  const [mailType, setMailType] = useState<RecommendationMailType>('document')
  const [weightInput, setWeightInput] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [deliveryDaysInput, setDeliveryDaysInput] = useState('')
  const [queryError, setQueryError] = useState('')
  const [criteria, setCriteria] = useState<RecommendationCriteria | null>(null)
  const [results, setResults] = useState<ServiceRecommendation[]>([])
  const destinations = useMemo(() => uniqueDestinationChoices(), [])
  const destinationIndex = useMemo(
    () => new Map(destinations.map((destination) => [destination.id, destination])),
    [destinations],
  )

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      setWorkspace(loaded)
      if (loaded.draft) setSender(loaded.draft.sender)
      setLoading(false)
    }).catch((error: unknown) => {
      if (!active) return
      setLoading(false)
      setLoadError(error instanceof Error ? error.message : '客户数据读取失败。')
    })
    return () => {
      active = false
    }
  }, [loadAttempt, repository])

  async function saveCustomer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!workspace) return
    const validation = validateSender(sender, false)
    if (!validation.valid) {
      setSenderErrors(validation.errors)
      return
    }
    const existing = workspace.draft
    const draft: CustomerDraft = {
      productFamily: existing?.productFamily ?? 'basic-letter',
      destinationRegion: existing?.destinationRegion ?? 'domestic',
      sender,
      recipient: existing?.recipient ?? createEmptyRecipient(),
      status: existing?.status ?? 'sender-ready',
      updatedAt: new Date().toISOString(),
    }
    setSavingCustomer(true)
    setSaveError('')
    try {
      const next = await repository.saveDraft(draft)
      setWorkspace(next)
      setSenderErrors({})
      setCustomerDialogOpen(false)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '客户资料保存失败。')
    } finally {
      setSavingCustomer(false)
    }
  }

  function selectAgreementAccount(value: string): void {
    if (!workspace) return
    const account = workspace.agreementAccounts.find((candidate) => candidate.id === value)
    if (!account) {
      setSender((current) => ({
        ...current,
        agreementAccountId: null,
        agreementAccountName: '',
      }))
      return
    }
    setSender((current) => ({
      ...current,
      agreementAccountId: account.id,
      agreementAccountName: account.name,
      contact: account.contact,
      name: account.senderName,
      identityType: account.identityType ?? '',
      identityValue: account.identityValue ?? '',
      gender: account.gender ?? '',
      detailedAddress: account.detailedAddress,
      unit: account.unit,
      postalCode: account.postalCode,
    }))
    setSenderAddressId('')
    setSenderErrors({})
    setSaveError('')
  }

  function selectSenderAddress(value: string): void {
    setSenderAddressId(value)
    const address = FICTIONAL_ADDRESSES.find((candidate) => candidate.id === value)
    if (!address) return
    setSender((current) => ({
      ...current,
      detailedAddress: address.detailedAddress,
      postalCode: address.mode === 'domestic' ? address.postalCode : '',
    }))
    setSenderErrors({})
  }

  function searchRecommendations(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const weight = Number(weightInput)
    const deliveryDays = deliveryDaysInput ? Number(deliveryDaysInput) : null
    const destination = destinationIndex.get(destinationId)
    if (!destination) {
      setQueryError('请选择寄达局。')
      setResults([])
      return
    }

    const nextCriteria: RecommendationCriteria = {
      mailType,
      weightGrams: weight,
      destinationZone: destination.zone,
      destinationOffice: destination.office,
      destinationLabel: destination.label,
      requestedDeliveryDays: deliveryDays,
    }
    try {
      const nextResults = recommendServiceProducts(
        SERVICE_PRODUCTS,
        nextCriteria,
        Boolean(workspace?.draft?.sender.agreementAccountId),
      )
      setCriteria(nextCriteria)
      setResults(nextResults)
      setQueryError(nextResults.length === 0 ? '没有匹配的业务产品。' : '')
    } catch (error) {
      setCriteria(null)
      setResults([])
      setQueryError(error instanceof Error ? error.message : '业务推荐查询失败。')
    }
  }

  function chooseRecommendation(recommendation: ServiceRecommendation): void {
    if (!criteria) return
    onSelect(createRecommendationTransfer(recommendation, criteria))
  }

  if (loading) {
    return <section className="recommendation-workspace">
      <RecommendationBreadcrumb onBack={onBack} />
      <p className="recommendation-loading" aria-live="polite" role="status">正在准备业务推荐数据…</p>
    </section>
  }

  if (loadError || !workspace) {
    return <section className="recommendation-workspace">
      <RecommendationBreadcrumb onBack={onBack} />
      <div className="recommendation-load-error">
        <p role="alert">业务推荐客户资料读取失败：{loadError || '客户数据不可用。'}</p>
        <button onClick={() => {
          setLoading(true)
          setLoadError('')
          setWorkspace(null)
          setLoadAttempt((attempt) => attempt + 1)
        }} type="button">重新读取</button>
      </div>
    </section>
  }

  return (
    <>
      <div className="recommendation-workspace">
        <RecommendationBreadcrumb onBack={onBack} />

        <div className="recommendation-customer-strip">
          <span>当前客户信息</span>
          <strong>{workspace.draft?.sender.name || '尚未采集'}</strong>
          <span>{workspace.draft?.sender.contact || '—'}</span>
          <button onClick={() => setCustomerDialogOpen(true)} type="button">
            {workspace.draft ? '修改客户信息' : '采集客户信息'}
          </button>
        </div>

        <form className="recommendation-query" onSubmit={searchRecommendations}>
          <label>
            <span>邮件类型：</span>
            <select aria-label="推荐邮件类型" onChange={(event) => setMailType(event.target.value as RecommendationMailType)} value={mailType}>
              <option value="document">文件型</option>
              <option value="goods">物品型</option>
            </select>
          </label>
          <label>
            <span>重量(克)：</span>
            <input aria-label="推荐邮件重量" inputMode="numeric" min="1" onChange={(event) => setWeightInput(event.target.value)} type="number" value={weightInput} />
          </label>
          <label className="recommendation-destination-field">
            <span>寄达局：</span>
            <select aria-label="推荐寄达局" onChange={(event) => setDestinationId(event.target.value)} value={destinationId}>
              <option value="">请选择寄达局</option>
              <optgroup label="模拟境内地址">
                {destinations.filter((destination) => destination.zone !== 'international').map((destination) => (
                  <option key={destination.id} value={destination.id}>{destination.label}</option>
                ))}
              </optgroup>
              <optgroup label="国际寄达地">
                {destinations.filter((destination) => destination.zone === 'international').map((destination) => (
                  <option key={destination.id} value={destination.id}>{destination.label}</option>
                ))}
              </optgroup>
            </select>
          </label>
          <label>
            <span>寄达时限(天)：</span>
            <input aria-label="推荐寄达时限" inputMode="numeric" min="1" onChange={(event) => setDeliveryDaysInput(event.target.value)} placeholder="寄达时限" type="number" value={deliveryDaysInput} />
          </label>
          <button className="recommendation-search-button" type="submit">⌕ 查询</button>
        </form>

        {queryError ? <p className="recommendation-error" role="alert">{queryError}</p> : null}

        <div className="recommendation-table-wrap">
          <table className="recommendation-table">
            <thead>
              <tr>
                <th>序号</th><th>业务产品代码</th><th>业务产品名称</th>
                <th>推荐级别</th><th>备注</th><th>应收资费(元)</th>
                <th>实收资费(元)</th><th>寄达时限(天)</th><th>重量(g)</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {results.map((recommendation, index) => (
                <tr key={recommendation.product.id}>
                  <td>{index + 1}</td>
                  <td>{recommendation.effectiveBusinessCode}</td>
                  <td>{recommendation.product.label}</td>
                  <td>{recommendation.recommendationLevel}级</td>
                  <td>{remarkLabel(recommendation)}</td>
                  <td>{recommendation.charge ? formatCents(recommendation.charge.postageCents) : '待核价'}</td>
                  <td>{recommendation.charge ? formatCents(recommendation.charge.postageCents) : '待核价'}</td>
                  <td>{recommendation.deliveryDays ?? '—'}</td>
                  <td>{criteria?.weightGrams ?? '—'}</td>
                  <td><button className="recommendation-select-button" onClick={() => chooseRecommendation(recommendation)} type="button">✉ 选择</button></td>
                </tr>
              ))}
              {results.length === 0 ? (
                <tr><td className="home-empty-cell" colSpan={10}>请填写条件后查询</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {customerDialogOpen ? (
        <Modal eyebrow="业务推荐" title="客户信息采集" wide>
          <form className="modal-form recommendation-customer-form" onSubmit={(event) => void saveCustomer(event)}>
            <div className="recommendation-customer-grid">
              <label><span>协议客户编号</span><select aria-label="推荐协议客户编号" onChange={(event) => selectAgreementAccount(event.target.value)} value={sender.agreementAccountId ?? ''}><option value="">请选择协议客户</option>{workspace.agreementAccounts.map((account) => <option key={account.id} value={account.id}>{account.id}</option>)}</select></label>
              <label><span>协议客户名称</span><input aria-label="推荐协议客户名称" readOnly value={sender.agreementAccountName} /></label>
              <label><span>联系电话</span><input aria-label="推荐客户联系电话" onChange={(event) => { setSender((current) => ({ ...current, contact: event.target.value })); setSenderErrors({}) }} value={sender.contact} /><FieldError message={senderErrors.contact} /></label>
              <label><span>姓名</span><input aria-label="推荐客户姓名" onChange={(event) => { setSender((current) => ({ ...current, name: event.target.value })); setSenderErrors({}) }} value={sender.name} /></label>
              <label><span>证件类型</span><select aria-label="推荐客户证件类型" onChange={(event) => { setSender((current) => ({ ...current, identityType: event.target.value as SenderProfile['identityType'] })); setSenderErrors({}) }} value={sender.identityType}><option value="">请选择</option><option value="primary">居民身份证</option><option value="temporary">临时身份证明</option><option value="residence">居留证明</option><option value="travel">旅行证明</option></select><FieldError message={senderErrors.identityType} /></label>
              <label><span>证件号码</span><input aria-label="推荐客户证件号码" maxLength={sender.identityType === 'primary' ? 18 : 20} onChange={(event) => { setSender((current) => ({ ...current, identityValue: event.target.value })); setSenderErrors({}) }} value={sender.identityValue} /><FieldError message={senderErrors.identityValue} /></label>
              <label><span>性别</span><select aria-label="推荐客户性别" onChange={(event) => setSender((current) => ({ ...current, gender: event.target.value as SenderProfile['gender'] }))} value={sender.gender}><option value="">请选择</option><option value="female">女</option><option value="male">男</option><option value="unspecified">不指定</option></select></label>
              <label><span>模拟地址点选</span><select aria-label="推荐客户地址点选" onChange={(event) => selectSenderAddress(event.target.value)} value={senderAddressId}><option value="">请选择</option>{FICTIONAL_ADDRESSES.filter((address) => address.mode === 'domestic').map((address) => <option key={address.id} value={address.id}>{compactHierarchy(address)}</option>)}</select></label>
              <label className="recommendation-customer-address"><span>详细地址</span><input aria-label="推荐客户详细地址" onChange={(event) => { setSender((current) => ({ ...current, detailedAddress: event.target.value })); setSenderErrors({}) }} value={sender.detailedAddress} /><FieldError message={senderErrors.detailedAddress} /></label>
              <label><span>单位地址</span><input aria-label="推荐客户单位地址" onChange={(event) => { setSender((current) => ({ ...current, unit: event.target.value })); setSenderErrors({}) }} value={sender.unit} /></label>
              <label><span>邮编</span><input aria-label="推荐客户邮编" inputMode="numeric" maxLength={6} onChange={(event) => { setSender((current) => ({ ...current, postalCode: event.target.value })); setSenderErrors({}) }} value={sender.postalCode} /><FieldError message={senderErrors.postalCode} /></label>
            </div>
            {senderErrors.form ? <p className="customer-form-error" role="alert">{senderErrors.form}</p> : null}
            {saveError ? <p className="customer-form-error" role="alert">客户资料保存失败：{saveError}</p> : null}
            <p className="recommendation-card-boundary" id="recommendation-card-boundary">实体联名卡设备未接入；协议客户编号只读取当前浏览器内的演练客户台账。</p>
            <div className="modal-actions">
              <button aria-describedby="recommendation-card-boundary" className="secondary-button" disabled type="button">刷联名卡</button>
              <button className="primary-button primary-button--compact" disabled={savingCustomer} type="submit">{savingCustomer ? '正在保存…' : '确定'}</button>
              <button className="secondary-button" onClick={() => setCustomerDialogOpen(false)} type="button">取消</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  )
}
