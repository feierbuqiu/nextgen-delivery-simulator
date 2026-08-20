import { useEffect, useMemo, useState } from 'react'

import { latestDispatchBagHandover } from '../../domain/service/dispatchBagHandover'
import {
  dispatchBagSealingMode,
  dispatchMailReferenceKey,
  queryUnsealedMail,
} from '../../domain/service/mailSealing'
import type { ServiceRepository } from '../../domain/service/repository'
import { serviceOperatorInstitutionCode } from '../../domain/service/institutionScope'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import type {
  DispatchBagRecord,
  DispatchBagShift,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'
import { SealingModeTabs, type SealingSection } from './SealingModeTabs'

interface SealedBagMaintenancePanelProps {
  repository: ServiceRepository
  operator: ServiceOperatorSnapshot
  onBack: () => void
  onSectionChange: (section: SealingSection) => void
}

type BulkFlag = 'bulk' | 'single'

interface SealedBagQuery {
  operatorId: string
  sealedDate: string
  shift: DispatchBagShift | ''
  bulkFlag: BulkFlag
}

function bagDay(value: string): string {
  return businessCalendarDay(value)
}

function isBulkBag(workspace: ServiceWorkspaceState, bag: DispatchBagRecord): boolean {
  return bag.mailReferences.some((reference) => {
    if (reference.kind === 'bulk-row') return true
    return Boolean(workspace.transactions.find((transaction) =>
      transaction.id === reference.transactionId)?.sourceBatchId)
  })
}

function canMaintain(workspace: ServiceWorkspaceState, bag: DispatchBagRecord, day: string): boolean {
  const handover = latestDispatchBagHandover(workspace, bag.id)
  return bag.sealingStatus === 'sealed' &&
    bagDay(bag.generatedAt) === day &&
    (!handover || handover.status === 'withdrawn' || handover.status === 'returned')
}

function sealingModeLabel(bag: DispatchBagRecord): string {
  const mode = dispatchBagSealingMode(bag)
  if (mode === 'loose-outbound') return '散件外走'
  if (mode === 'sorting') return '分拣封发'
  return '普通封发'
}

export function SealedBagMaintenancePanel({
  repository,
  operator,
  onBack,
  onSectionChange,
}: SealedBagMaintenancePanelProps) {
  const institutionCode = serviceOperatorInstitutionCode(operator)
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [query, setQuery] = useState<SealedBagQuery>({
    operatorId: '',
    sealedDate: businessCalendarDay(new Date()),
    shift: '',
    bulkFlag: 'single',
  })
  const [appliedQuery, setAppliedQuery] = useState(query)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [manifestBag, setManifestBag] = useState<DispatchBagRecord | null>(null)
  const [manifestNumber, setManifestNumber] = useState('')
  const [mailBag, setMailBag] = useState<DispatchBagRecord | null>(null)
  const [addedKeys, setAddedKeys] = useState<string[]>([])
  const [removedKeys, setRemovedKeys] = useState<string[]>([])
  const [shiftOpen, setShiftOpen] = useState(false)
  const [targetShift, setTargetShift] = useState<DispatchBagShift>('01')

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      const next: SealedBagQuery = {
        operatorId: '',
        sealedDate: businessCalendarDay(new Date()),
        shift: '',
        bulkFlag: 'single',
      }
      setWorkspace(loaded)
      setQuery(next)
      setAppliedQuery(next)
    })
    return () => { active = false }
  }, [repository])

  const rows = useMemo(() => {
    if (!workspace) return []
    return workspace.dispatchBags
      .filter((bag) => bag.sealingStatus === 'sealed')
      .filter((bag) => (
        bag.originOfficeCode ?? serviceOperatorInstitutionCode(bag.generatedBy)
      ) === institutionCode)
      .filter((bag) => !appliedQuery.operatorId || bag.generatedBy.operatorId === appliedQuery.operatorId)
      .filter((bag) => bagDay(bag.generatedAt) === appliedQuery.sealedDate)
      .filter((bag) => !appliedQuery.shift || bag.shift === appliedQuery.shift)
      .filter((bag) => isBulkBag(workspace, bag) === (appliedQuery.bulkFlag === 'bulk'))
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
  }, [appliedQuery, institutionCode, workspace])
  const selectedRows = rows.filter((bag) => selectedIds.includes(bag.id))
  const allSelected = rows.length > 0 && selectedRows.length === rows.length
  const operatorOptions = useMemo(() => {
    if (!workspace) return []
    return [...new Map(workspace.dispatchBags.filter((bag) => (
      bag.originOfficeCode ?? serviceOperatorInstitutionCode(bag.generatedBy)
    ) === institutionCode).map((bag) => [
      bag.generatedBy.operatorId,
      bag.generatedBy.displayName,
    ])).entries()]
  }, [institutionCode, workspace])
  const candidateItems = useMemo(() => {
    if (!workspace || !mailBag) return []
    return queryUnsealedMail(workspace, {
      operatorId: '',
      bulkFlag: 'all',
      acceptedDateFrom: '',
      acceptedDateTo: '',
    }, institutionCode).groups
      .filter((group) => group.relation.manifestTypeCode === mailBag.manifestTypeCode &&
        group.relation.receivingOfficeCode === mailBag.receivingOfficeCode &&
        group.relation.directSeal === mailBag.directSeal &&
        group.relation.consolidation === mailBag.consolidation &&
        group.relation.localTransfer === mailBag.localTransfer)
      .flatMap((group) => group.items)
  }, [institutionCode, mailBag, workspace])

  function updateQuery<Key extends keyof SealedBagQuery>(key: Key, value: SealedBagQuery[Key]): void {
    setQuery((current) => ({ ...current, [key]: value }))
    setNotice('')
    setError('')
  }

  function runQuery(): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.sealedDate)) {
      setError('封发日期须按 YYYY-MM-DD 格式填写。')
      return
    }
    setAppliedQuery(structuredClone(query))
    setSelectedIds([])
    setNotice('查询完成。')
    setError('')
  }

  function toggle(id: string): void {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id])
  }

  function toggleAll(): void {
    setSelectedIds(allSelected ? [] : rows.map((bag) => bag.id))
  }

  function requireSelection(action: string): boolean {
    if (selectedRows.length > 0) return true
    setError(`请选择需要${action}的总包。`)
    return false
  }

  function openManifest(bag: DispatchBagRecord): void {
    setManifestBag(bag)
    setManifestNumber(bag.manifestNumber)
    setError('')
  }

  function openMailChange(bag: DispatchBagRecord): void {
    setMailBag(bag)
    setAddedKeys([])
    setRemovedKeys([])
    setError('')
  }

  async function reviseManifest(): Promise<void> {
    if (!manifestBag) return
    try {
      const result = await repository.executeMailSealing({
        type: 'revise-dispatch-bag-manifest',
        bagId: manifestBag.id,
        manifestNumber,
        changedAt: new Date().toISOString(),
        operator,
      })
      setWorkspace(result.state)
      setManifestBag(null)
      setNotice('清单号修改成功。')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '清单号修改失败。')
    }
  }

  async function reviseMails(): Promise<void> {
    if (!mailBag) return
    const currentByKey = new Map(mailBag.mailReferences.map((reference) => [
      dispatchMailReferenceKey(reference), reference,
    ]))
    const candidateByKey = new Map(candidateItems.map((item) => [item.key, item.reference]))
    try {
      const result = await repository.executeMailSealing({
        type: 'revise-dispatch-bag-mails',
        bagId: mailBag.id,
        addMailReferences: addedKeys.flatMap((key) => candidateByKey.get(key) ? [candidateByKey.get(key)!] : []),
        removeMailReferences: removedKeys.flatMap((key) => currentByKey.get(key) ? [currentByKey.get(key)!] : []),
        changedAt: new Date().toISOString(),
        operator,
      })
      setWorkspace(result.state)
      setMailBag(null)
      setNotice('总包邮件查改成功。')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '总包邮件查改失败。')
    }
  }

  async function transferShift(): Promise<void> {
    try {
      const result = await repository.executeMailSealing({
        type: 'transfer-sealed-bag-shift',
        bagIds: selectedRows.map((bag) => bag.id),
        shift: targetShift,
        changedAt: new Date().toISOString(),
        operator,
      })
      setWorkspace(result.state)
      setSelectedIds([])
      setShiftOpen(false)
      setNotice(`班次转移成功，共 ${result.bags.length} 袋。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '班次转移失败。')
    }
  }

  async function cancelSealing(): Promise<void> {
    if (!requireSelection('撤销封发')) return
    try {
      const result = await repository.executeMailSealing({
        type: 'cancel-dispatch-bags',
        bagIds: selectedRows.map((bag) => bag.id),
        cancelledAt: new Date().toISOString(),
        operator,
      })
      setWorkspace(result.state)
      setSelectedIds([])
      setNotice(`撤销封发成功，共 ${result.bags.length} 袋；邮件已回到未封发池。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '撤销封发失败。')
    }
  }

  if (!workspace) return <section className="mail-handover mail-handover--loading">正在读取已封发数据…</section>

  return (
    <>
      <div className="mail-handover mail-sealing sealed-bag-maintenance">
        <div className="customer-breadcrumb"><button onClick={onBack} type="button">营业工作台</button><span>/</span><span>邮件封发</span><span>/</span><strong>封发处理</strong></div>
        <SealingModeTabs active="sealed" onSelect={onSectionChange} />
        <section aria-label="已封发查改查询条件" className="mail-handover__query">
          <div className="mail-handover__filters sealed-bag-maintenance__filters">
            <label><span>封发员工</span><select aria-label="已封发封发员工" onChange={(event) => updateQuery('operatorId', event.target.value)} value={query.operatorId}><option value="">全部</option>{operatorOptions.map(([id, name]) => <option key={id} value={id}>{name}（{id}）</option>)}</select></label>
            <label><span>封发日期</span><input aria-label="已封发封发日期" onChange={(event) => updateQuery('sealedDate', event.target.value)} type="date" value={query.sealedDate} /></label>
            <label><span>班次</span><select aria-label="已封发班次" onChange={(event) => updateQuery('shift', event.target.value as DispatchBagShift | '')} value={query.shift}><option value="">全部</option><option value="01">01</option><option value="02">02</option><option value="03">03</option></select></label>
            <fieldset><legend>大宗标志</legend><label><input checked={query.bulkFlag === 'single'} name="sealed-bulk" onChange={() => updateQuery('bulkFlag', 'single')} type="radio" />零散</label><label><input checked={query.bulkFlag === 'bulk'} name="sealed-bulk" onChange={() => updateQuery('bulkFlag', 'bulk')} type="radio" />大宗</label></fieldset>
          </div>
          <div className="mail-handover__actions"><button onClick={runQuery} type="button">查询</button><button className="mail-handover__action-primary" onClick={() => void cancelSealing()} type="button">撤销封发</button><button onClick={() => { if (requireSelection('转移班次')) { setTargetShift('01'); setShiftOpen(true) } }} type="button">转移班次</button></div>
        </section>
        <p className="sealed-bag-maintenance__warning">非当日封发总包以及已交出的总包不能解封、查改。</p>
        <section aria-label="已封发查改查询结果" className="mail-handover__results">
          <header><span>已封发总包</span><strong>{rows.length} 袋</strong></header>
          <div className="mail-handover__table-wrap"><table className="mail-handover__table"><thead><tr><th><input aria-label="选择全部已封发总包" checked={allSelected} onChange={toggleAll} type="checkbox" /></th><th>序号</th><th>封发方式</th><th>清单种类代码</th><th>清单种类</th><th>总包接收局</th><th>封发班次</th><th>总包条码</th><th>清单号码</th><th>件数</th><th>操作</th></tr></thead><tbody>{rows.map((bag, index) => { const editable = canMaintain(workspace, bag, businessCalendarDay(new Date())); const mailEditable = editable && dispatchBagSealingMode(bag) !== 'loose-outbound'; return <tr key={bag.id}><td><input aria-label={`选择已封发总包 ${bag.bagBarcode}`} checked={selectedIds.includes(bag.id)} onChange={() => toggle(bag.id)} type="checkbox" /></td><td>{index + 1}</td><td>{sealingModeLabel(bag)}</td><td>{bag.manifestTypeCode}</td><td>{bag.manifestTypeName}</td><td>{bag.receivingOfficeName}<small>{bag.receivingOfficeCode}</small></td><td>{bag.shift}</td><td>{bag.bagBarcode}</td><td>{bag.manifestNumber}</td><td>{bag.totalItems}</td><td><button className="mail-sealing__link-button" disabled={!mailEditable} onClick={() => openMailChange(bag)} type="button">总包查改</button><button className="mail-sealing__link-button" disabled={!editable} onClick={() => openManifest(bag)} type="button">修改清单号</button></td></tr> })}{rows.length === 0 ? <tr><td colSpan={11}>无数据</td></tr> : null}</tbody></table></div>
          {notice ? <p className="customer-notice" role="status">{notice}</p> : null}{error && !manifestBag && !mailBag && !shiftOpen ? <p className="customer-form-error" role="alert">{error}</p> : null}
        </section>
      </div>

      {manifestBag ? <Modal eyebrow="已封发查改" title="修改清单号"><div className="modal-form"><label><span>清单类型</span><input readOnly value={`${manifestBag.manifestTypeName}（${manifestBag.manifestTypeCode}）`} /></label><label><span>原清单号</span><input readOnly value={manifestBag.manifestNumber} /></label><label><span>新清单号</span><input aria-label="新清单号" inputMode="numeric" maxLength={3} onChange={(event) => setManifestNumber(event.target.value.replace(/\D/g, '').slice(0, 3))} value={manifestNumber} /></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setManifestBag(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void reviseManifest()} type="button">确定</button></div></div></Modal> : null}
      {mailBag ? <Modal eyebrow="已封发查改" title="总包邮件查改"><div className="sealed-bag-maintenance__mail-change"><section><h3>包内邮件（勾选删除）</h3>{mailBag.mailReferences.map((reference) => { const key = dispatchMailReferenceKey(reference); return <label key={key}><input checked={removedKeys.includes(key)} onChange={() => setRemovedKeys((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key])} type="checkbox" />{key}</label> })}</section><section><h3>可追加邮件</h3>{candidateItems.map((item) => <label key={item.key}><input checked={addedKeys.includes(item.key)} onChange={() => setAddedKeys((current) => current.includes(item.key) ? current.filter((value) => value !== item.key) : [...current, item.key])} type="checkbox" />{item.itemNumber} / {item.product.label}</label>)}{candidateItems.length === 0 ? <p>无同封发关系的未封发邮件</p> : null}</section>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setMailBag(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void reviseMails()} type="button">确定</button></div></div></Modal> : null}
      {shiftOpen ? <Modal eyebrow="已封发查改" title="转移班次"><div className="modal-form"><label><span>目标班次</span><select aria-label="已封发目标班次" onChange={(event) => setTargetShift(event.target.value as DispatchBagShift)} value={targetShift}><option value="01">01</option><option value="02">02</option><option value="03">03</option></select></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setShiftOpen(false); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void transferShift()} type="button">确定</button></div></div></Modal> : null}
    </>
  )
}
