import { useMemo, useState } from 'react'

import {
  dispatchRelationForMail,
  queryAvailableUnsealedMail,
  queryLooseOutboundMail,
  type LooseOutboundMailQuery,
  type UnsealedMailItem,
} from '../../domain/service/mailSealing'
import type { ServiceRepository } from '../../domain/service/repository'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import type {
  DispatchBagShift,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'
import { SealingModeTabs, type SealingSection } from './SealingModeTabs'

interface LooseOutboundSealingPanelProps {
  workspace: ServiceWorkspaceState
  repository: ServiceRepository
  operator: ServiceOperatorSnapshot
  institutionCode: string
  onBack: () => void
  onSectionChange: (section: SealingSection) => void
  onWorkspaceChange: (workspace: ServiceWorkspaceState) => void
  now?: Date
}

function initialQuery(now = new Date()): LooseOutboundMailQuery {
  const day = businessCalendarDay(now)
  return { productTerm: '', acceptedDateFrom: day, acceptedDateTo: day }
}

function validDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00`))
}

export function LooseOutboundSealingPanel({
  workspace,
  repository,
  operator,
  institutionCode,
  onBack,
  onSectionChange,
  onWorkspaceChange,
  now,
}: LooseOutboundSealingPanelProps) {
  const [query, setQuery] = useState<LooseOutboundMailQuery>(() => initialQuery(now))
  const [appliedQuery, setAppliedQuery] = useState<LooseOutboundMailQuery>(() =>
    initialQuery(now))
  const [selectedKey, setSelectedKey] = useState('')
  const [pickedItem, setPickedItem] = useState<UnsealedMailItem | null>(null)
  const [pickingOpen, setPickingOpen] = useState(false)
  const [pickingNumber, setPickingNumber] = useState('')
  const [pickingResult, setPickingResult] = useState<UnsealedMailItem | null>(null)
  const [shiftOpen, setShiftOpen] = useState(false)
  const [shift, setShift] = useState<DispatchBagShift>('01')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const rows = useMemo(() => queryLooseOutboundMail(workspace, appliedQuery, institutionCode), [
    appliedQuery,
    institutionCode,
    workspace,
  ])
  const selectedItem = rows.find((item) => item.key === selectedKey) ??
    (pickedItem?.key === selectedKey ? pickedItem : null)

  function updateQuery<Key extends keyof LooseOutboundMailQuery>(
    key: Key,
    value: LooseOutboundMailQuery[Key],
  ): void {
    setQuery((current) => ({ ...current, [key]: value }))
    setError('')
    setNotice('')
  }

  async function runQuery(): Promise<void> {
    if (!validDay(query.acceptedDateFrom) || !validDay(query.acceptedDateTo)) {
      setError('收寄日期必须使用 YYYY-MM-DD 格式。')
      return
    }
    if (query.acceptedDateFrom > query.acceptedDateTo) {
      setError('收寄开始日期不能晚于结束日期。')
      return
    }
    const loaded = await repository.load()
    onWorkspaceChange(loaded)
    setAppliedQuery({ ...query })
    setSelectedKey('')
    setPickedItem(null)
    setNotice('查询完成。')
    setError('')
  }

  function openElectronicPicking(): void {
    setPickingNumber('')
    setPickingResult(null)
    setPickingOpen(true)
    setError('')
  }

  async function searchElectronicPicking(): Promise<void> {
    const itemNumber = pickingNumber.trim()
    if (!itemNumber) {
      setError('请输入邮件号码。')
      return
    }
    const loaded = await repository.load()
    onWorkspaceChange(loaded)
    const matches = queryAvailableUnsealedMail(loaded, institutionCode).filter((item) =>
      item.itemNumber === itemNumber && item.quantity === 1 &&
      dispatchRelationForMail(item, loaded.dispatchRelationOverrides) !== null)
    if (matches.length === 0) {
      setPickingResult(null)
      setError('未找到可散件外走的未封发邮件。')
      return
    }
    if (matches.length > 1) {
      setPickingResult(null)
      setError('邮件号码不唯一，请返回列表核对。')
      return
    }
    setPickingResult(matches[0]!)
    setError('')
  }

  function confirmElectronicPicking(): void {
    if (!pickingResult) {
      setError('请先查询并确认邮件。')
      return
    }
    setPickedItem(pickingResult)
    setSelectedKey(pickingResult.key)
    setPickingOpen(false)
    setNotice(`已电子勾挑邮件 ${pickingResult.itemNumber}。`)
    setError('')
  }

  function openGenerate(): void {
    if (!selectedItem) {
      setError('请选择一件需要散件外走的邮件。')
      return
    }
    setShift('01')
    setShiftOpen(true)
    setError('')
  }

  async function generateLooseOutbound(): Promise<void> {
    if (!selectedItem) return
    try {
      const latest = await repository.load()
      const result = await repository.executeMailSealing({
        type: 'generate-dispatch-bags',
        sealingMode: 'loose-outbound',
        manifests: [{
          mailReferences: [selectedItem.reference],
          manifestNumber: String(latest.nextDispatchManifestSequence).padStart(3, '0'),
          receptacleType: '1.袋',
          usesBarcodeContainer: false,
          containerBarcode: '',
          rfidBagTagNumber: '',
        }],
        shift,
        institutionCode,
        generatedAt: (now ?? new Date()).toISOString(),
        operator,
      })
      const bag = result.bags[0]!
      onWorkspaceChange(result.state)
      setSelectedKey('')
      setPickedItem(null)
      setShiftOpen(false)
      setNotice(
        `总包生成成功，总包号码 ${bag.bagBarcode}；散件外走邮件不打印袋牌。`,
      )
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '散件外走总包生成失败。')
    }
  }

  return (
    <>
      <div className="mail-handover mail-sealing loose-outbound-sealing">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">营业工作台</button>
          <span>/</span><span>邮件封发</span><span>/</span><strong>封发处理</strong>
        </div>
        <SealingModeTabs active="loose-outbound" onSelect={onSectionChange} />

        <section aria-label="散件外走查询条件" className="mail-handover__query">
          <div className="mail-handover__filters mail-sealing__filters">
            <label><span>业务产品</span><input aria-label="散件外走业务产品" onChange={(event) => updateQuery('productTerm', event.target.value)} placeholder="名称或业务代码" value={query.productTerm} /></label>
            <label className="mail-handover__date-range"><span>收寄日期</span><span><input aria-label="散件外走收寄开始日期" onChange={(event) => updateQuery('acceptedDateFrom', event.target.value)} type="date" value={query.acceptedDateFrom} /><b>至</b><input aria-label="散件外走收寄结束日期" onChange={(event) => updateQuery('acceptedDateTo', event.target.value)} type="date" value={query.acceptedDateTo} /></span></label>
          </div>
          <div className="mail-handover__actions">
            <button onClick={() => void runQuery()} type="button">查询</button>
            <button onClick={openElectronicPicking} type="button">电子勾挑</button>
            <button className="mail-handover__action-primary" onClick={openGenerate} type="button">总包生成</button>
          </div>
        </section>

        <p className="sealed-bag-maintenance__warning">散件外走一次只能选择一件邮件；生成后的总包号码使用该邮件号码，且不打印袋牌。</p>
        <section aria-label="散件外走查询结果" className="mail-handover__results">
          <header><span>可外走邮件</span><strong>{rows.length} 件</strong></header>
          <div className="mail-handover__table-wrap">
            <table className="mail-handover__table">
              <thead><tr><th>选择</th><th>序号</th><th>业务产品</th><th>邮件号码</th><th>收件人</th><th>联系电话</th><th>寄达局</th><th>收寄时间</th></tr></thead>
              <tbody>
                {rows.map((item, index) => {
                  const relation = dispatchRelationForMail(
                    item,
                    workspace.dispatchRelationOverrides,
                  )!
                  return <tr className={selectedKey === item.key ? 'mail-sealing__row--selected' : undefined} key={item.key}><td><input aria-label={`选择散件外走邮件 ${item.itemNumber}`} checked={selectedKey === item.key} name="loose-outbound-mail" onChange={() => { setSelectedKey(item.key); setPickedItem(item) }} type="radio" /></td><td>{index + 1}</td><td>{item.product.label}<small>{item.product.effectiveBusinessCode}</small></td><td>{item.itemNumber}</td><td>{item.recipientName || '—'}</td><td>{item.recipientPhone || '—'}</td><td>{item.destinationOffice || relation.receivingOfficeName}</td><td>{item.acceptedAt.replace('T', ' ').slice(0, 19)}</td></tr>
                })}
                {rows.length === 0 ? <tr><td colSpan={8}>无数据</td></tr> : null}
              </tbody>
            </table>
          </div>
          {selectedItem && !rows.some((item) => item.key === selectedItem.key) ? <p className="customer-notice">电子勾挑：{selectedItem.itemNumber} / {selectedItem.product.label}</p> : null}
          {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
          {error && !pickingOpen && !shiftOpen ? <p className="customer-form-error" role="alert">{error}</p> : null}
        </section>
      </div>

      {pickingOpen ? (
        <Modal eyebrow="散件外走" title="电子勾挑">
          <div className="modal-form mail-handover__modal-form">
            <label><span>邮件号码</span><input aria-label="电子勾挑邮件号码" autoFocus onChange={(event) => { setPickingNumber(event.target.value); setPickingResult(null); setError('') }} value={pickingNumber} /></label>
            <div className="modal-actions"><button className="secondary-button" onClick={() => void searchElectronicPicking()} type="button">查询邮件</button></div>
            {pickingResult ? <dl className="status-list"><div><dt>邮件号码</dt><dd>{pickingResult.itemNumber}</dd></div><div><dt>收件人</dt><dd>{pickingResult.recipientName || '—'}</dd></div><div><dt>联系电话</dt><dd>{pickingResult.recipientPhone || '—'}</dd></div><div><dt>寄达局</dt><dd>{pickingResult.destinationOffice || dispatchRelationForMail(pickingResult, workspace.dispatchRelationOverrides)?.receivingOfficeName}</dd></div></dl> : null}
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setPickingOpen(false); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={confirmElectronicPicking} type="button">确定</button></div>
          </div>
        </Modal>
      ) : null}

      {shiftOpen ? (
        <Modal description={`总包号码将使用邮件号码 ${selectedItem?.itemNumber ?? ''}。`} eyebrow="散件外走" title="选择班次">
          <div className="modal-form mail-handover__modal-form"><label><span>班次</span><select aria-label="散件外走班次" onChange={(event) => setShift(event.target.value as DispatchBagShift)} value={shift}><option value="01">01</option><option value="02">02</option><option value="03">03</option></select></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setShiftOpen(false); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void generateLooseOutbound()} type="button">确定</button></div></div>
        </Modal>
      ) : null}
    </>
  )
}
