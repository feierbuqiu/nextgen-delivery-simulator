import { useMemo, useState } from 'react'

import {
  dispatchRelationForMail,
  dispatchRelationKey,
  queryAvailableUnsealedMail,
  SIMULATED_CONTAINER_INVENTORY,
  type DispatchManifestInput,
  type DispatchRelation,
  type UnsealedMailItem,
} from '../../domain/service/mailSealing'
import type { ServiceRepository } from '../../domain/service/repository'
import type {
  DispatchBagRecord,
  DispatchBagShift,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'
import { SealingModeTabs, type SealingSection } from './SealingModeTabs'

interface SortingSealingPanelProps {
  repository: ServiceRepository
  operator: ServiceOperatorSnapshot
  institutionCode: string
  onBack: () => void
  onSectionChange: (section: SealingSection) => void
  onWorkspaceChange: (workspace: ServiceWorkspaceState) => void
}

interface SortingManifestDraft {
  manifestNumber: string
  receptacleType: '1.袋'
  usesBarcodeContainer: boolean
  containerBarcode: string
  rfidBagTagNumber: string
}

interface SortingGroupDraft {
  key: string
  relation: DispatchRelation
  items: UnsealedMailItem[]
  manifest: SortingManifestDraft
}

interface SortingCapture {
  item: UnsealedMailItem
  relation: DispatchRelation
  groupKey: string
  manifest: SortingManifestDraft
}

function weightKilograms(grams: number): string {
  return (grams / 1000).toFixed(3)
}

export function SortingSealingPanel({
  repository,
  operator,
  institutionCode,
  onBack,
  onSectionChange,
  onWorkspaceChange,
}: SortingSealingPanelProps) {
  const [scanNumber, setScanNumber] = useState('')
  const [groups, setGroups] = useState<SortingGroupDraft[]>([])
  const [capture, setCapture] = useState<SortingCapture | null>(null)
  const [shiftOpen, setShiftOpen] = useState(false)
  const [shift, setShift] = useState<DispatchBagShift>('01')
  const [printPromptBags, setPrintPromptBags] = useState<DispatchBagRecord[]>([])
  const [printPreviewBags, setPrintPreviewBags] = useState<DispatchBagRecord[]>([])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const scannedItems = useMemo(() => groups.flatMap((group) =>
    group.items.map((item) => ({ group, item }))), [groups])

  async function scanMail(): Promise<void> {
    const itemNumber = scanNumber.trim()
    if (!itemNumber) {
      setError('请扫描或输入邮件号码。')
      return
    }
    if (scannedItems.some(({ item }) => item.itemNumber === itemNumber)) {
      setError(`邮件 ${itemNumber} 已扫描。`)
      return
    }
    const loaded = await repository.load()
    onWorkspaceChange(loaded)
    const matches = queryAvailableUnsealedMail(loaded, institutionCode).filter((item) =>
      item.itemNumber === itemNumber)
    if (matches.length === 0) {
      setError('未找到可分拣封发的未封发邮件。')
      return
    }
    if (matches.length > 1) {
      setError('邮件号码不唯一，不能继续扫描。')
      return
    }
    const item = matches[0]!
    const relation = dispatchRelationForMail(item, loaded.dispatchRelationOverrides)
    if (!relation) {
      setError('该邮件未维护封发关系，不能分拣封发。')
      return
    }
    const key = dispatchRelationKey(relation)
    const current = groups.find((group) => group.key === key)
    setCapture({
      item,
      relation,
      groupKey: key,
      manifest: current?.manifest ?? {
        manifestNumber: String(
          loaded.nextDispatchManifestSequence + groups.length,
        ).padStart(3, '0'),
        receptacleType: '1.袋',
        usesBarcodeContainer: false,
        containerBarcode: '',
        rfidBagTagNumber: '',
      },
    })
    setError('')
  }

  function updateCapture<Key extends keyof SortingManifestDraft>(
    key: Key,
    value: SortingManifestDraft[Key],
  ): void {
    setCapture((current) => current ? {
      ...current,
      manifest: { ...current.manifest, [key]: value },
    } : current)
    setError('')
  }

  function confirmCapture(): void {
    if (!capture) return
    const draft = capture.manifest
    if (!/^\d{3}$/.test(draft.manifestNumber)) {
      setError('清单号码必须为 3 位数字。')
      return
    }
    if (groups.some((group) => group.key !== capture.groupKey &&
      group.manifest.manifestNumber === draft.manifestNumber)) {
      setError(`清单号码 ${draft.manifestNumber} 已用于其他分组。`)
      return
    }
    if (draft.usesBarcodeContainer) {
      if (!/^\d{16}$/.test(draft.containerBarcode)) {
        setError('容器条码必须为 16 位数字。')
        return
      }
      if (!SIMULATED_CONTAINER_INVENTORY.includes(
        draft.containerBarcode as (typeof SIMULATED_CONTAINER_INVENTORY)[number],
      )) {
        setError('容器条码未入库，不能使用。')
        return
      }
      if (groups.some((group) => group.key !== capture.groupKey &&
        group.manifest.usesBarcodeContainer &&
        group.manifest.containerBarcode === draft.containerBarcode)) {
        setError(`容器条码 ${draft.containerBarcode} 已用于其他分组。`)
        return
      }
    }
    setGroups((current) => {
      const existing = current.find((group) => group.key === capture.groupKey)
      if (!existing) {
        return [...current, {
          key: capture.groupKey,
          relation: capture.relation,
          items: [capture.item],
          manifest: { ...draft },
        }]
      }
      return current.map((group) => group.key === capture.groupKey ? {
        ...group,
        items: [...group.items, capture.item],
        manifest: { ...draft },
      } : group)
    })
    setCapture(null)
    setScanNumber('')
    setNotice(
      `邮件 ${capture.item.itemNumber} 已归入 ${capture.relation.manifestTypeName} 分组。`,
    )
    setError('')
  }

  function removeScannedItem(key: string): void {
    setGroups((current) => current.flatMap((group) => {
      const items = group.items.filter((item) => item.key !== key)
      return items.length === 0 ? [] : [{ ...group, items }]
    }))
    setNotice('已移除扫描邮件。')
    setError('')
  }

  function openGenerate(): void {
    if (groups.length === 0) {
      setError('请先扫描需要分拣封发的邮件。')
      return
    }
    setShift('01')
    setShiftOpen(true)
    setError('')
  }

  async function generateSortedBags(): Promise<void> {
    const manifests: DispatchManifestInput[] = groups.map((group) => ({
      mailReferences: group.items.map((item) => item.reference),
      ...group.manifest,
    }))
    try {
      const result = await repository.executeMailSealing({
        type: 'generate-dispatch-bags',
        sealingMode: 'sorting',
        manifests,
        shift,
        institutionCode,
        generatedAt: new Date().toISOString(),
        operator,
      })
      onWorkspaceChange(result.state)
      setGroups([])
      setShiftOpen(false)
      setPrintPromptBags(result.bags)
      setNotice('')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '分拣封发总包生成失败。')
    }
  }

  async function recordPrintDecision(print: boolean): Promise<void> {
    try {
      const result = await repository.executeMailSealing({
        type: 'record-dispatch-bag-tag-decision',
        bagIds: printPromptBags.map((bag) => bag.id),
        print,
        decidedAt: new Date().toISOString(),
        institutionCode,
      })
      onWorkspaceChange(result.state)
      setPrintPromptBags([])
      if (print) setPrintPreviewBags(result.bags)
      else setNotice(`分拣封发完成，共生成 ${result.bags.length} 个总包；已选择不打印袋牌。`)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '袋牌打印决定记录失败。')
    }
  }

  return (
    <>
      <div className="mail-handover mail-sealing sorting-sealing">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">营业工作台</button>
          <span>/</span><span>邮件封发</span><span>/</span><strong>封发处理</strong>
        </div>
        <SealingModeTabs active="sorting" onSelect={onSectionChange} />

        <section aria-label="分拣封发扫描区" className="mail-handover__query">
          <div className="mail-handover__filters mail-sealing__filters">
            <label><span>邮件号码</span><input aria-label="分拣封发邮件号码" autoFocus onChange={(event) => { setScanNumber(event.target.value); setError(''); setNotice('') }} placeholder="逐件扫描或输入" value={scanNumber} /></label>
          </div>
          <div className="mail-handover__actions">
            <button onClick={() => void scanMail()} type="button">确认扫描</button>
            <button className="mail-handover__action-primary" onClick={openGenerate} type="button">总包生成</button>
            <button onClick={() => { setGroups([]); setNotice('扫描列表已清空。'); setError('') }} type="button">清空</button>
          </div>
        </section>

        <p className="sealed-bag-maintenance__warning">系统按清单种类、接收局和封发标志自动归组；相同封发关系只生成一个总包。</p>
        <section aria-label="分拣封发扫描结果" className="mail-handover__results">
          <header><span>已扫描邮件</span><strong>{scannedItems.length} 件 / {groups.length} 组</strong></header>
          <div className="mail-handover__table-wrap">
            <table className="mail-handover__table">
              <thead><tr><th>序号</th><th>邮件号码</th><th>业务产品</th><th>清单种类</th><th>总包接收局</th><th>清单号码</th><th>容器</th><th>RFID袋牌号</th><th>操作</th></tr></thead>
              <tbody>
                {scannedItems.map(({ group, item }, index) => <tr key={item.key}><td>{index + 1}</td><td>{item.itemNumber}</td><td>{item.product.label}<small>{item.product.effectiveBusinessCode}</small></td><td>{group.relation.manifestTypeName}<small>{group.relation.manifestTypeCode}</small></td><td>{group.relation.receivingOfficeName}<small>{group.relation.receivingOfficeCode}</small></td><td>{group.manifest.manifestNumber}</td><td>{group.manifest.usesBarcodeContainer ? group.manifest.containerBarcode : '非条码容器'}</td><td>{group.manifest.rfidBagTagNumber || '—'}</td><td><button className="mail-sealing__link-button" onClick={() => removeScannedItem(item.key)} type="button">移除</button></td></tr>)}
                {scannedItems.length === 0 ? <tr><td colSpan={9}>无数据</td></tr> : null}
              </tbody>
            </table>
          </div>
          {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
          {error && !capture && !shiftOpen && printPromptBags.length === 0 ? <p className="customer-form-error" role="alert">{error}</p> : null}
        </section>
      </div>

      {capture ? (
        <Modal description={`邮件 ${capture.item.itemNumber} 将自动归入对应封发关系。`} eyebrow="分拣封发" title="获取清单号信息">
          <div className="modal-form mail-handover__modal-form">
            <label><span>是否条码容器</span><select aria-label="分拣封发是否使用条码容器" onChange={(event) => updateCapture('usesBarcodeContainer', event.target.value === 'yes')} value={capture.manifest.usesBarcodeContainer ? 'yes' : 'no'}><option value="no">否</option><option value="yes">是</option></select></label>
            <label><span>容器</span><select aria-label="分拣封发容器" disabled value={capture.manifest.receptacleType}><option value="1.袋">1.袋</option></select></label>
            <label><span>清单类型</span><input aria-label="分拣封发清单类型" readOnly value={`${capture.relation.manifestTypeName}（${capture.relation.manifestTypeCode}）`} /></label>
            <label><span>清单号码</span><input aria-label="分拣封发清单号码" inputMode="numeric" maxLength={3} onChange={(event) => updateCapture('manifestNumber', event.target.value.replace(/\D/g, '').slice(0, 3))} value={capture.manifest.manifestNumber} /></label>
            {capture.manifest.usesBarcodeContainer ? <label><span>容器条码</span><input aria-label="分拣封发容器条码" inputMode="numeric" list="sorting-container-inventory" maxLength={16} onChange={(event) => updateCapture('containerBarcode', event.target.value.replace(/\D/g, '').slice(0, 16))} value={capture.manifest.containerBarcode} /><datalist id="sorting-container-inventory">{SIMULATED_CONTAINER_INVENTORY.map((barcode) => <option key={barcode} value={barcode} />)}</datalist></label> : null}
            <label><span>RFID袋牌号</span><input aria-label="分拣封发 RFID 袋牌号" onChange={(event) => updateCapture('rfidBagTagNumber', event.target.value)} value={capture.manifest.rfidBagTagNumber} /></label>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setCapture(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={confirmCapture} type="button">确定</button></div>
          </div>
        </Modal>
      ) : null}

      {shiftOpen ? (
        <Modal description={`将按 ${groups.length} 个封发关系生成总包。`} eyebrow="分拣封发" title="选择班次">
          <div className="modal-form mail-handover__modal-form"><label><span>班次</span><select aria-label="分拣封发班次" onChange={(event) => setShift(event.target.value as DispatchBagShift)} value={shift}><option value="01">01</option><option value="02">02</option><option value="03">03</option></select></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setShiftOpen(false); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void generateSortedBags()} type="button">确定</button></div></div>
        </Modal>
      ) : null}

      {printPromptBags.length > 0 ? (
        <Modal description={`已生成 ${printPromptBags.length} 个总包。`} eyebrow="分拣封发" title="总包生成成功！是否打印袋牌？">
          <div className="modal-actions"><button className="secondary-button" onClick={() => void recordPrintDecision(false)} type="button">不打印</button><button className="primary-button primary-button--compact" onClick={() => void recordPrintDecision(true)} type="button">打印</button></div>
          {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
        </Modal>
      ) : null}

      {printPreviewBags.length > 0 ? (
        <Modal description={`共 ${printPreviewBags.length} 张袋牌。`} eyebrow="袋牌打印" title="分拣封发袋牌预览" wide>
          <div className="mail-sealing__tag-sheet">{printPreviewBags.map((bag) => <article className="mail-sealing__tag" key={bag.id}><header><strong>{bag.manifestTypeName}</strong><span>{bag.manifestTypeCode}</span></header><div className="mail-sealing__tag-barcode" aria-label={`总包条码 ${bag.bagBarcode}`}>{bag.bagBarcode}</div><dl><div><dt>总包接收局</dt><dd>{bag.receivingOfficeName}</dd></div><div><dt>清单号码</dt><dd>{bag.manifestNumber}</dd></div><div><dt>班次</dt><dd>{bag.shift}</dd></div><div><dt>件数</dt><dd>{bag.totalItems}</dd></div><div><dt>重量</dt><dd>{weightKilograms(bag.mailWeightGrams)} kg</dd></div><div><dt>封发员工</dt><dd>{bag.generatedBy.displayName}</dd></div></dl></article>)}</div>
          <div className="modal-actions"><button className="secondary-button" onClick={() => setPrintPreviewBags([])} type="button">关闭</button><button className="primary-button primary-button--compact" onClick={() => window.print()} type="button">打印袋牌</button></div>
        </Modal>
      ) : null}
    </>
  )
}
