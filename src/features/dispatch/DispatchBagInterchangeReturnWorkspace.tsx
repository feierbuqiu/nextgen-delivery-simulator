import { useEffect, useMemo, useState } from 'react'

import {
  queryExportedBagForInterchangeReturn,
  verifyExportedBagForInterchangeReturn,
  type DispatchInterchangeReturnCandidate,
  type DispatchInterchangeReturnQuery,
} from '../../domain/service/dispatchBalanceReturn'
import { serviceOperatorInstitutionCode } from '../../domain/service/institutionScope'
import type { ServiceRepository } from '../../domain/service/repository'
import type {
  DispatchBagShift,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import { Modal } from '../../ui/Modal'

interface DispatchBagInterchangeReturnWorkspaceProps {
  repository: ServiceRepository
  operator: ServiceOperatorSnapshot
  onBack: () => void
  now?: Date
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

export function DispatchBagInterchangeReturnWorkspace({
  repository,
  operator,
  onBack,
  now,
}: DispatchBagInterchangeReturnWorkspaceProps) {
  const institutionCode = serviceOperatorInstitutionCode(operator)
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [query, setQuery] = useState<DispatchInterchangeReturnQuery>({
    bagBarcode: '',
    sealingDate: businessCalendarDay(now ?? new Date()),
  })
  const [candidate, setCandidate] = useState<DispatchInterchangeReturnCandidate | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [returnOpen, setReturnOpen] = useState(false)
  const [emptyBagWeight, setEmptyBagWeight] = useState('0')
  const [bagTotalWeight, setBagTotalWeight] = useState('')
  const [shift, setShift] = useState<DispatchBagShift>('01')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      setWorkspace(loaded)
      setQuery((current) => ({
        ...current,
        sealingDate: businessCalendarDay(now ?? new Date()),
      }))
    })
    return () => {
      active = false
    }
  }, [now, repository])

  const selectedMails = useMemo(() => {
    const selected = new Set(selectedKeys)
    return candidate?.mails.filter((mail) => selected.has(mail.key)) ?? []
  }, [candidate, selectedKeys])
  const selectedItems = selectedMails.reduce((sum, mail) => sum + mail.quantity, 0)
  const selectedMailWeight = selectedMails.reduce((sum, mail) => sum + mail.weightGrams, 0)

  function runQuery(): void {
    if (!workspace) return
    try {
      const found = queryExportedBagForInterchangeReturn(workspace, query, institutionCode)
      setCandidate(found)
      setSelectedKeys(found?.mails.map((mail) => mail.key) ?? [])
      setNotice(found ? `查询完成，共 ${found.mails.length} 件邮件。` : '未查询到符合条件的已出口总包。')
      setError('')
    } catch (caught) {
      setCandidate(null)
      setSelectedKeys([])
      setNotice('')
      setError(caught instanceof Error ? caught.message : '总包查询失败。')
    }
  }

  function resetQuery(): void {
    if (!workspace) return
    setQuery({ bagBarcode: '', sealingDate: businessCalendarDay(now ?? new Date()) })
    setCandidate(null)
    setSelectedKeys([])
    setNotice('')
    setError('')
  }

  function toggleMail(key: string): void {
    setSelectedKeys((current) => current.includes(key)
      ? current.filter((candidateKey) => candidateKey !== key)
      : [...current, key])
  }

  function toggleAll(): void {
    if (!candidate) return
    setSelectedKeys((current) => current.length === candidate.mails.length
      ? []
      : candidate.mails.map((mail) => mail.key))
  }

  function runElectronicCheck(): void {
    if (!workspace || !candidate) {
      setError('请先查询已出口总包。')
      return
    }
    try {
      const checked = verifyExportedBagForInterchangeReturn(
        workspace,
        candidate.bag.id,
        institutionCode,
      )
      setNotice(`电子勾核通过：${checked.totalItems} 件，${checked.bagTotalWeightGrams} 克。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '电子勾核失败。')
    }
  }

  function openReturnDialog(): void {
    if (!candidate) {
      setError('请先查询已出口总包。')
      return
    }
    if (selectedKeys.length === 0) {
      setError('总包退回后至少保留一件邮件。')
      return
    }
    if (selectedKeys.length === candidate.mails.length) {
      setError('请取消勾选需要剔除的问题邮件。')
      return
    }
    const initialEmptyBagWeight = Math.max(0, candidate.bag.emptyBagWeightGrams)
    setEmptyBagWeight(String(initialEmptyBagWeight))
    setBagTotalWeight(String(selectedMailWeight + initialEmptyBagWeight))
    setShift(candidate.bag.shift)
    setError('')
    setReturnOpen(true)
  }

  async function confirmReturn(): Promise<void> {
    if (!workspace || !candidate) return
    try {
      const result = await repository.executeDispatchBalanceReturn({
        type: 'return-dispatch-bag-to-interchange',
        bagId: candidate.bag.id,
        keptMailReferenceKeys: selectedKeys,
        emptyBagWeightGrams: Number(emptyBagWeight),
        bagTotalWeightGrams: Number(bagTotalWeight),
        shift,
        returnedAt: (now ?? new Date()).toISOString(),
        operator,
      })
      setWorkspace(result.state)
      setCandidate(null)
      setSelectedKeys([])
      setReturnOpen(false)
      setNotice('总包退回互换局成功。')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '总包退回互换局失败。')
    }
  }

  if (!workspace) {
    return <section className="mail-handover mail-handover--loading">正在读取总包数据…</section>
  }

  return (
    <>
      <div className="mail-handover dispatch-interchange-return">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">营业工作台</button><span>/</span><span>邮件封发</span><span>/</span><strong>总包退回互换局</strong>
        </div>

        <section aria-label="总包退回互换局查询条件" className="mail-handover__query dispatch-interchange-return__query">
          <div className="mail-handover__filters dispatch-interchange-return__filters">
            <label><span>总包条码</span><input aria-label="退回总包条码" autoFocus onChange={(event) => setQuery((current) => ({ ...current, bagBarcode: event.target.value }))} placeholder="请输入总包条码" value={query.bagBarcode} /></label>
            <label><span>封发日期</span><input aria-label="退回总包封发日期" onChange={(event) => setQuery((current) => ({ ...current, sealingDate: event.target.value }))} type="date" value={query.sealingDate} /></label>
          </div>
          <div className="mail-handover__actions">
            <button onClick={runQuery} type="button">查询</button>
            <button className="mail-handover__action-primary" onClick={openReturnDialog} type="button">退回互换局</button>
            <button className="mail-handover__action-primary" onClick={runElectronicCheck} type="button">电子勾核</button>
            <button onClick={resetQuery} type="button">重置</button>
          </div>
        </section>

        <section aria-label="总包退回互换局查询结果" className="mail-handover__results">
          <header><span>总包内邮件</span><strong>{candidate?.mails.length ?? 0} 条</strong></header>
          <div className="mail-handover__table-wrap">
            <table className="mail-handover__table dispatch-interchange-return__table">
              <thead><tr><th><input aria-label="选择全部退回邮件" checked={Boolean(candidate && selectedKeys.length === candidate.mails.length)} onChange={toggleAll} type="checkbox" /></th><th>序号</th><th>业务产品名称</th><th>邮件号码</th><th>寄达局</th><th>备注</th><th>重量(g)</th><th>审核人</th></tr></thead>
              <tbody>
                {candidate?.mails.map((mail, index) => (
                  <tr className={selectedKeys.includes(mail.key) ? 'mail-sealing__row--selected' : undefined} key={mail.key}>
                    <td><input aria-label={`选择邮件 ${mail.itemNumber}`} checked={selectedKeys.includes(mail.key)} onChange={() => toggleMail(mail.key)} type="checkbox" /></td>
                    <td>{index + 1}</td><td>{mail.productName}</td><td>{mail.itemNumber}</td><td>{mail.destinationOffice || '—'}</td><td>{mail.note || '—'}</td><td>{mail.weightGrams}</td><td>{mail.reviewerName || '—'}</td>
                  </tr>
                ))}
                {!candidate ? <tr><td colSpan={8}>无数据</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
        {error && !returnOpen ? <p className="customer-form-error" role="alert">{error}</p> : null}
      </div>

      {returnOpen && candidate ? (
        <Modal description={candidate.bag.bagBarcode} eyebrow="总包退回互换局" title="获取总包退回信息">
          <div className="mail-handover__modal-form dispatch-interchange-return__form">
            <label><span>空袋重量(g)</span><input aria-label="空袋重量" inputMode="numeric" onChange={(event) => setEmptyBagWeight(digitsOnly(event.target.value))} value={emptyBagWeight} /></label>
            <label><span>总包重量(g)</span><input aria-label="总包重量" inputMode="numeric" onChange={(event) => setBagTotalWeight(digitsOnly(event.target.value))} value={bagTotalWeight} /></label>
            <label><span>邮件重量(g)</span><input aria-label="邮件重量" readOnly value={selectedMailWeight} /></label>
            <label><span>邮件件数(件)</span><input aria-label="邮件件数" readOnly value={selectedItems} /></label>
            <label><span>封发班次</span><select aria-label="退回封发班次" onChange={(event) => setShift(event.target.value as DispatchBagShift)} value={shift}><option value="01">01</option><option value="02">02</option><option value="03">03</option></select></label>
          </div>
          {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
          <div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => void confirmReturn()} type="button">确定</button><button className="secondary-button" onClick={() => setReturnOpen(false)} type="button">取消</button></div>
        </Modal>
      ) : null}
    </>
  )
}
