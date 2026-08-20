import { useEffect, useMemo, useState } from 'react'

import {
  queryDispatchPrintRows,
  type DispatchPrintQuery,
  type DispatchPrintRow,
} from '../../domain/service/dispatchRouting'
import type { ServiceRepository } from '../../domain/service/repository'
import { serviceOperatorInstitutionCode } from '../../domain/service/institutionScope'
import type {
  DispatchPrintDocumentType,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { businessCalendarDay } from '../../domain/shared/businessTime'
import { Modal } from '../../ui/Modal'

interface DispatchPrintWorkspaceProps {
  repository: ServiceRepository
  operator: ServiceOperatorSnapshot
  onBack: () => void
  now?: Date
}

interface PrintPreview {
  title: string
  documentType: DispatchPrintDocumentType
  rows: DispatchPrintRow[]
  weightGrams: number | null
  remark: string
}

function defaultQuery(now = new Date()): DispatchPrintQuery {
  return {
    sealingDate: businessCalendarDay(now),
    shift: '01',
    packageType: '1',
    employeeTerm: '',
    manifestTypeTerm: '',
    dataType: 'unprinted',
  }
}

function documentTypeForQuery(query: DispatchPrintQuery): DispatchPrintDocumentType {
  if (query.packageType === '1') return 'manifest'
  if (query.packageType === '3') return 'route'
  return 'master-route'
}

function previewTitle(documentType: DispatchPrintDocumentType): string {
  const labels: Record<DispatchPrintDocumentType, string> = {
    manifest: '清单打印预览',
    route: '路单打印预览',
    'master-route': '总路单打印预览',
    'bag-tag': '袋牌打印预览',
    'receipt-bag-tag': '票据打印机袋牌预览',
    'address-bag-tag': '名址袋牌打印预览',
    'premade-bag-tag': '预制袋牌打印预览',
  }
  return labels[documentType]
}

export function DispatchPrintWorkspace({
  repository,
  operator,
  onBack,
  now,
}: DispatchPrintWorkspaceProps) {
  const institutionCode = serviceOperatorInstitutionCode(operator)
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [query, setQuery] = useState<DispatchPrintQuery>(() => defaultQuery(now))
  const [appliedQuery, setAppliedQuery] = useState<DispatchPrintQuery | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [preview, setPreview] = useState<PrintPreview | null>(null)
  const [premadeOpen, setPremadeOpen] = useState(false)
  const [premadeWeight, setPremadeWeight] = useState('')
  const [premadeRemark, setPremadeRemark] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      const initial = defaultQuery(now)
      setWorkspace(loaded)
      setQuery(initial)
      setAppliedQuery(initial)
    })
    return () => {
      active = false
    }
  }, [now, repository])

  const rows = useMemo(() => {
    if (!workspace || !appliedQuery) return []
    try {
      return queryDispatchPrintRows(workspace, appliedQuery, institutionCode)
    } catch {
      return []
    }
  }, [appliedQuery, institutionCode, workspace])
  const selectedRows = rows.filter((row) => selectedIds.includes(row.targetId))
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.targetId))

  function updateQuery<Key extends keyof DispatchPrintQuery>(
    key: Key,
    value: DispatchPrintQuery[Key],
  ): void {
    setQuery((current) => ({ ...current, [key]: value }))
    setNotice('')
    setError('')
  }

  function runQuery(): void {
    if (!workspace) return
    try {
      queryDispatchPrintRows(workspace, query, institutionCode)
      setAppliedQuery(structuredClone(query))
      setSelectedIds([])
      setNotice('查询完成。')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '打印数据查询失败。')
    }
  }

  async function recordPrint(
    documentType: DispatchPrintDocumentType,
    targets: DispatchPrintRow[],
    weightGrams: number | null = null,
    remark = '',
  ): Promise<boolean> {
    if (targets.length === 0) {
      setError('请选择需要打印的记录。')
      return false
    }
    try {
      const result = await repository.executeDispatchRouting({
        type: 'record-dispatch-print',
        documentType,
        targetIds: targets.map((row) => row.targetId),
        printedAt: new Date().toISOString(),
        operator,
        weightGrams,
        remark,
      })
      setWorkspace(result.state)
      setSelectedIds([])
      setPreview({
        title: previewTitle(documentType),
        documentType,
        rows: structuredClone(targets),
        weightGrams,
        remark,
      })
      setNotice(`已生成 ${targets.length} 份${previewTitle(documentType).replace('预览', '')}记录。`)
      setError('')
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '打印记录保存失败。')
      return false
    }
  }

  function printOrdinary(): void {
    const effectiveQuery = appliedQuery ?? query
    const targets = effectiveQuery.dataType === 'all' ? rows : selectedRows
    void recordPrint(documentTypeForQuery(effectiveQuery), targets)
  }

  function printBagTag(documentType: Extract<DispatchPrintDocumentType,
    'bag-tag' | 'receipt-bag-tag' | 'address-bag-tag'>): void {
    if ((appliedQuery ?? query).packageType !== '1') {
      setError('袋牌打印只适用于清单记录。')
      return
    }
    void recordPrint(documentType, selectedRows)
  }

  function openPremade(): void {
    if ((appliedQuery ?? query).packageType !== '1' || selectedRows.length !== 1) {
      setError('预制袋牌需要选择一条清单记录。')
      return
    }
    setPremadeWeight(String(selectedRows[0]!.totalWeightGrams))
    setPremadeRemark('')
    setPremadeOpen(true)
    setError('')
  }

  async function confirmPremade(): Promise<void> {
    const weight = Number(premadeWeight)
    if (await recordPrint('premade-bag-tag', selectedRows, weight, premadeRemark)) {
      setPremadeOpen(false)
    }
  }

  if (!workspace) {
    return <section className="mail-handover mail-handover--loading">正在读取打印数据…</section>
  }

  return (
    <>
      <div className="mail-handover dispatch-print">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">营业工作台</button><span>/</span><span>邮件封发</span><span>/</span><strong>路单/清单打印</strong>
        </div>

        <section aria-label="路单清单打印查询条件" className="mail-handover__query">
          <div className="mail-handover__filters dispatch-print__filters">
            <label><span>封发日期</span><input aria-label="打印封发日期" onChange={(event) => updateQuery('sealingDate', event.target.value)} type="date" value={query.sealingDate} /></label>
            <label><span>班次 *</span><select aria-label="打印班次" onChange={(event) => updateQuery('shift', event.target.value as DispatchPrintQuery['shift'])} value={query.shift}><option value="01">01</option><option value="02">02</option><option value="03">03</option></select></label>
            <label><span>总包类型</span><select aria-label="打印总包类型" onChange={(event) => updateQuery('packageType', event.target.value as DispatchPrintQuery['packageType'])} value={query.packageType}><option value="1">1.清单</option><option value="3">3.路单</option><option value="4">4.总路单</option></select></label>
            <label><span>封发员工</span><input aria-label="打印封发员工" onChange={(event) => updateQuery('employeeTerm', event.target.value)} placeholder="工号或姓名" value={query.employeeTerm} /></label>
            <label><span>清单种类</span><input aria-label="打印清单种类" onChange={(event) => updateQuery('manifestTypeTerm', event.target.value)} placeholder="名称或代码" value={query.manifestTypeTerm} /></label>
            <fieldset><legend>数据类型</legend><label><input checked={query.dataType === 'unprinted'} name="dispatch-print-data-type" onChange={() => updateQuery('dataType', 'unprinted')} type="radio" />未打印清单</label><label><input checked={query.dataType === 'all'} name="dispatch-print-data-type" onChange={() => updateQuery('dataType', 'all')} type="radio" />所有清单</label></fieldset>
          </div>
          <div className="mail-handover__actions dispatch-print__actions">
            <button onClick={runQuery} type="button">查询</button>
            <button className="mail-handover__action-primary" onClick={printOrdinary} type="button">打印</button>
            <button onClick={() => printBagTag('bag-tag')} type="button">袋牌打印</button>
            <button onClick={() => printBagTag('receipt-bag-tag')} type="button">袋牌打印（票据打印机）</button>
            <button onClick={() => printBagTag('address-bag-tag')} type="button">名址袋牌打印</button>
            <button onClick={openPremade} type="button">预制袋牌</button>
          </div>
        </section>

        <section aria-label="路单清单打印结果" className="mail-handover__results">
          <header><span>打印数据</span><strong>{rows.length} 条</strong></header>
          <div className="mail-handover__table-wrap">
            <table className="mail-handover__table dispatch-print__table">
              <thead><tr><th><input aria-label="选择全部打印记录" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : rows.map((row) => row.targetId))} type="checkbox" /></th><th>序号</th><th>类型</th><th>单据号码</th><th>邮路代码</th><th>清单种类</th><th>清单号码</th><th>接收局</th><th>班次</th><th>总包数</th><th>件数</th><th>重量（克）</th><th>打印状态</th></tr></thead>
              <tbody>{rows.map((row, index) => <tr key={row.targetId}><td><input aria-label={`选择打印记录 ${row.documentNumber}`} checked={selectedIds.includes(row.targetId)} onChange={() => setSelectedIds((current) => current.includes(row.targetId) ? current.filter((id) => id !== row.targetId) : [...current, row.targetId])} type="checkbox" /></td><td>{index + 1}</td><td>{row.documentTypeName}</td><td>{row.documentNumber}</td><td>{row.routeCode || '—'}<small>{row.routeName || '—'}</small></td><td>{row.manifestTypeName || '多种清单'}<small>{row.manifestTypeCode || '—'}</small></td><td>{row.manifestNumbers.join('、') || '—'}</td><td>{row.receivingOfficeName || '—'}</td><td>{row.shift}</td><td>{row.totalBags}</td><td>{row.totalItems}</td><td>{row.totalWeightGrams}</td><td>{row.printed ? '已打印' : '未打印'}</td></tr>)}{rows.length === 0 ? <tr><td colSpan={13}>无数据</td></tr> : null}</tbody>
            </table>
          </div>
          {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
          {error && !premadeOpen ? <p className="customer-form-error" role="alert">{error}</p> : null}
        </section>
      </div>

      {premadeOpen ? (
        <Modal description="仅调整本次预制袋牌的重量和备注，不修改原总包。" eyebrow="路单/清单打印" title="预制袋牌">
          <div className="modal-form mail-handover__modal-form"><label><span>重量（克）</span><input aria-label="预制袋牌重量" inputMode="numeric" onChange={(event) => setPremadeWeight(event.target.value)} value={premadeWeight} /></label><label><span>备注</span><textarea aria-label="预制袋牌备注" onChange={(event) => setPremadeRemark(event.target.value)} rows={3} value={premadeRemark} /></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setPremadeOpen(false); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void confirmPremade()} type="button">打印预览</button></div></div>
        </Modal>
      ) : null}

      {preview ? (
        <Modal description={`共 ${preview.rows.length} 条记录。`} eyebrow="模拟打印" title={preview.title} wide>
          <article className="dispatch-print__preview">
            <header><strong>本地寄递演练样张 · 无效</strong><span>{preview.title.replace('预览', '')}</span></header>
            <table><thead><tr><th>单据号</th><th>类型</th><th>清单种类</th><th>接收局</th><th>班次</th><th>总包数</th><th>重量（克）</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.targetId}><td>{row.documentNumber}</td><td>{row.documentTypeName}</td><td>{row.manifestTypeName || '多种清单'}</td><td>{row.receivingOfficeName || '—'}</td><td>{row.shift}</td><td>{row.totalBags}</td><td>{preview.documentType === 'premade-bag-tag' ? preview.weightGrams : row.totalWeightGrams}</td></tr>)}</tbody></table>
            {preview.documentType === 'address-bag-tag' ? <p>名址：{preview.rows.map((row) => `${row.receivingOfficeName} ${row.receivingOfficeCode}`).join('；')}</p> : null}
            {preview.remark ? <p>备注：{preview.remark}</p> : null}
          </article>
          <div className="modal-actions"><button className="secondary-button" onClick={() => setPreview(null)} type="button">关闭</button><button className="primary-button primary-button--compact" onClick={() => window.print()} type="button">调用浏览器打印</button></div>
        </Modal>
      ) : null}
    </>
  )
}
