import { useEffect, useMemo, useState } from 'react'

import {
  queryUnsealedMail,
  SIMULATED_CONTAINER_INVENTORY,
  type DispatchManifestInput,
  type UnsealedMailGroup,
  type UnsealedMailItem,
  type UnsealedMailQuery,
} from '../../domain/service/mailSealing'
import type { ServiceRepository } from '../../domain/service/repository'
import {
  businessCalendarDay,
  isValidBusinessCalendarDay,
} from '../../domain/shared/businessTime'
import type {
  DispatchBagRecord,
  ServiceOperatorSnapshot,
  ServiceWorkspaceState,
} from '../../domain/service/types'
import { Modal } from '../../ui/Modal'
import { LooseOutboundSealingPanel } from './LooseOutboundSealingPanel'
import { SealedBagMaintenancePanel } from './SealedBagMaintenancePanel'
import { SealingModeTabs, type SealingSection } from './SealingModeTabs'
import { SortingSealingPanel } from './SortingSealingPanel'

interface MailSealingWorkspaceProps {
  repository: ServiceRepository
  operator: ServiceOperatorSnapshot
  institutionCode: string
  onBack: () => void
  now?: Date
}

interface ManifestDraft {
  groupKey: string
  manifestNumber: string
  receptacleType: '1.袋'
  usesBarcodeContainer: boolean
  containerBarcode: string
  rfidBagTagNumber: string
}

type DispatchShift = '01' | '02' | '03'

function defaultQuery(now = new Date()): UnsealedMailQuery {
  const day = businessCalendarDay(now)
  return {
    operatorId: '',
    bulkFlag: 'all',
    acceptedDateFrom: day,
    acceptedDateTo: day,
  }
}

function isValidDay(value: string): boolean {
  return isValidBusinessCalendarDay(value)
}

function weightKilograms(grams: number): string {
  return (grams / 1000).toFixed(3)
}

function flagLabel(value: boolean): string {
  return value ? '是' : '否'
}

function destinationZoneLabel(zone: UnsealedMailItem['destinationZone']): string {
  return zone === 'local' ? '本埠' : zone === 'nonlocal' ? '国内异地' : '境外'
}

function nextManifestNumber(workspace: ServiceWorkspaceState, offset: number): string {
  return String(workspace.nextDispatchManifestSequence + offset).padStart(3, '0')
}

export function MailSealingWorkspace({
  repository,
  operator,
  institutionCode,
  onBack,
  now,
}: MailSealingWorkspaceProps) {
  const [workspace, setWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [activeSection, setActiveSection] = useState<SealingSection>('unsealed')
  const [query, setQuery] = useState<UnsealedMailQuery>(() => defaultQuery(now))
  const [appliedQuery, setAppliedQuery] = useState<UnsealedMailQuery>(() => defaultQuery(now))
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<string[]>([])
  const [preparedManifests, setPreparedManifests] = useState<Record<string, ManifestDraft>>({})
  const [captureGroup, setCaptureGroup] = useState<UnsealedMailGroup | null>(null)
  const [captureDraft, setCaptureDraft] = useState<ManifestDraft | null>(null)
  const [detailGroup, setDetailGroup] = useState<UnsealedMailGroup | null>(null)
  const [shiftOpen, setShiftOpen] = useState(false)
  const [shift, setShift] = useState<DispatchShift>('01')
  const [printPromptBags, setPrintPromptBags] = useState<DispatchBagRecord[]>([])
  const [printPreviewBags, setPrintPreviewBags] = useState<DispatchBagRecord[]>([])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void repository.load().then((loaded) => {
      if (!active) return
      const initialQuery = defaultQuery(now)
      setWorkspace(loaded)
      setQuery(initialQuery)
      setAppliedQuery(initialQuery)
    })
    return () => {
      active = false
    }
  }, [now, repository])

  const queryResult = useMemo(() => workspace
    ? queryUnsealedMail(workspace, appliedQuery, institutionCode)
    : { groups: [], unconfiguredCount: 0, unconfiguredItems: [] }, [
      appliedQuery,
      institutionCode,
      workspace,
    ])

  const operatorOptions = useMemo(() => {
    if (!workspace) return []
    const values = new Map<string, string>()
    for (const transaction of workspace.transactions) {
      if (transaction.operator.institutionCode !== institutionCode) continue
      values.set(transaction.operator.operatorId, transaction.operator.displayName)
    }
    for (const batch of workspace.bulkBatches) {
      if (batch.operator.institutionCode !== institutionCode) continue
      values.set(batch.operator.operatorId, batch.operator.displayName)
    }
    return [...values.entries()].sort(([left], [right]) => left.localeCompare(right))
  }, [institutionCode, workspace])

  const allPreparedSelected = queryResult.groups.length > 0 && queryResult.groups.every((group) =>
    selectedGroupKeys.includes(group.key) && Boolean(preparedManifests[group.key]))

  async function showSection(section: SealingSection): Promise<void> {
    const loaded = await repository.load()
    setWorkspace(loaded)
    setActiveSection(section)
    setNotice('')
    setError('')
  }

  function updateQuery<Key extends keyof UnsealedMailQuery>(
    key: Key,
    value: UnsealedMailQuery[Key],
  ): void {
    setQuery((current) => ({ ...current, [key]: value }))
    setError('')
    setNotice('')
  }

  function validateQuery(candidate: UnsealedMailQuery): boolean {
    if (!isValidDay(candidate.acceptedDateFrom) || !isValidDay(candidate.acceptedDateTo)) {
      setError('收寄日期必须使用 YYYY-MM-DD 格式。')
      return false
    }
    if (candidate.acceptedDateFrom > candidate.acceptedDateTo) {
      setError('收寄开始日期不能晚于结束日期。')
      return false
    }
    return true
  }

  async function runQuery(): Promise<void> {
    if (!validateQuery(query)) return
    try {
      const loaded = await repository.load()
      setWorkspace(loaded)
      setAppliedQuery({ ...query })
      setSelectedGroupKeys([])
      setPreparedManifests({})
      setNotice('查询完成。')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '查询失败。')
    }
  }

  function resetQuery(): void {
    const reset = defaultQuery(now)
    setQuery(reset)
    setAppliedQuery(reset)
    setSelectedGroupKeys([])
    setPreparedManifests({})
    setNotice('')
    setError('')
  }

  async function refreshDispatchRelations(): Promise<void> {
    if (!validateQuery(query)) return
    try {
      const loaded = await repository.load()
      const refreshed = queryUnsealedMail(loaded, query, institutionCode)
      setWorkspace(loaded)
      setAppliedQuery({ ...query })
      setSelectedGroupKeys([])
      setPreparedManifests({})
      setNotice(
        `封发关系刷新完成，匹配 ${refreshed.groups.length} 组，${refreshed.unconfiguredCount} 件未维护封发关系。`,
      )
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '封发关系刷新失败。')
    }
  }

  function openManifestCapture(group: UnsealedMailGroup): void {
    if (!workspace) return
    const current = preparedManifests[group.key]
    setCaptureGroup(group)
    setCaptureDraft(current ?? {
      groupKey: group.key,
      manifestNumber: nextManifestNumber(workspace, Object.keys(preparedManifests).length),
      receptacleType: '1.袋',
      usesBarcodeContainer: false,
      containerBarcode: '',
      rfidBagTagNumber: '',
    })
    setError('')
  }

  function toggleGroup(group: UnsealedMailGroup): void {
    if (selectedGroupKeys.includes(group.key)) {
      setSelectedGroupKeys((current) => current.filter((key) => key !== group.key))
      return
    }
    if (!preparedManifests[group.key]) {
      openManifestCapture(group)
      return
    }
    setSelectedGroupKeys((current) => [...current, group.key])
  }

  function toggleAllGroups(): void {
    if (allPreparedSelected) {
      setSelectedGroupKeys([])
      return
    }
    const unprepared = queryResult.groups.find((group) => !preparedManifests[group.key])
    if (unprepared) {
      setNotice('请逐条采集清单信息。')
      openManifestCapture(unprepared)
      return
    }
    setSelectedGroupKeys(queryResult.groups.map((group) => group.key))
  }

  function updateCaptureDraft<Key extends keyof ManifestDraft>(
    key: Key,
    value: ManifestDraft[Key],
  ): void {
    setCaptureDraft((current) => current ? { ...current, [key]: value } : current)
    setError('')
  }

  function confirmManifestCapture(): void {
    if (!captureGroup || !captureDraft) return
    if (!/^\d{3}$/.test(captureDraft.manifestNumber)) {
      setError('清单号码必须为 3 位数字。')
      return
    }
    if (captureDraft.usesBarcodeContainer) {
      if (!/^\d{16}$/.test(captureDraft.containerBarcode)) {
        setError('容器条码必须为 16 位数字。')
        return
      }
      if (!SIMULATED_CONTAINER_INVENTORY.includes(
        captureDraft.containerBarcode as (typeof SIMULATED_CONTAINER_INVENTORY)[number],
      )) {
        setError('容器条码未入库，不能使用。')
        return
      }
    }
    setPreparedManifests((current) => ({
      ...current,
      [captureGroup.key]: { ...captureDraft },
    }))
    setSelectedGroupKeys((current) => current.includes(captureGroup.key)
      ? current
      : [...current, captureGroup.key])
    setCaptureGroup(null)
    setCaptureDraft(null)
    setNotice('清单信息采集完成。')
    setError('')
  }

  function openShiftSelection(): void {
    if (selectedGroupKeys.length === 0) {
      setError('请先勾选需要生成总包的清单。')
      return
    }
    const missing = selectedGroupKeys.find((key) => !preparedManifests[key])
    if (missing) {
      setError('所选记录尚未完成清单信息采集。')
      return
    }
    setShift('01')
    setShiftOpen(true)
    setError('')
  }

  async function generateBags(): Promise<void> {
    if (!workspace) return
    const selectedGroups = queryResult.groups.filter((group) =>
      selectedGroupKeys.includes(group.key))
    const manifests: DispatchManifestInput[] = selectedGroups.flatMap((group) => {
      const draft = preparedManifests[group.key]
      if (!draft) return []
      return [{
        mailReferences: group.items.map((item) => item.reference),
        manifestNumber: draft.manifestNumber,
        receptacleType: draft.receptacleType,
        usesBarcodeContainer: draft.usesBarcodeContainer,
        containerBarcode: draft.containerBarcode,
        rfidBagTagNumber: draft.rfidBagTagNumber,
      }]
    })
    if (manifests.length !== selectedGroups.length) {
      setError('所选记录尚未完成清单信息采集。')
      return
    }
    try {
      const result = await repository.executeMailSealing({
        type: 'generate-dispatch-bags',
        manifests,
        shift,
        institutionCode,
        generatedAt: new Date().toISOString(),
        operator,
      })
      setWorkspace(result.state)
      setShiftOpen(false)
      setSelectedGroupKeys([])
      setPreparedManifests({})
      setPrintPromptBags(result.bags)
      setNotice('')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '总包生成失败。')
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
      setWorkspace(result.state)
      setPrintPromptBags([])
      if (print) {
        setPrintPreviewBags(result.bags)
      } else {
        setNotice(`总包生成成功，共 ${result.bags.length} 袋；已选择不打印袋牌。`)
      }
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '袋牌打印决定记录失败。')
    }
  }

  if (!workspace) {
    return <section className="mail-handover mail-handover--loading">正在读取邮件封发数据…</section>
  }

  if (activeSection === 'sealed') {
    return (
      <SealedBagMaintenancePanel
        onBack={onBack}
        onSectionChange={(section) => void showSection(section)}
        operator={operator}
        repository={repository}
      />
    )
  }

  if (activeSection === 'loose-outbound') {
    return (
      <LooseOutboundSealingPanel
        institutionCode={institutionCode}
        onBack={onBack}
        onSectionChange={(section) => void showSection(section)}
        onWorkspaceChange={setWorkspace}
        operator={operator}
        repository={repository}
        workspace={workspace}
        now={now}
      />
    )
  }

  if (activeSection === 'sorting') {
    return (
      <SortingSealingPanel
        institutionCode={institutionCode}
        onBack={onBack}
        onSectionChange={(section) => void showSection(section)}
        onWorkspaceChange={setWorkspace}
        operator={operator}
        repository={repository}
      />
    )
  }

  return (
    <>
      <div className="mail-handover mail-sealing">
        <div className="customer-breadcrumb">
          <button onClick={onBack} type="button">营业工作台</button><span>/</span><span>邮件封发</span><span>/</span><strong>封发处理</strong>
        </div>

        <SealingModeTabs
          active="unsealed"
          onSelect={(section) => void showSection(section)}
        />

        <section aria-label="未封发处理查询条件" className="mail-handover__query">
          <div className="mail-handover__filters mail-sealing__filters">
            <label><span>收寄员工</span><select aria-label="未封发收寄员工" onChange={(event) => updateQuery('operatorId', event.target.value)} value={query.operatorId}><option value="">全部</option>{operatorOptions.map(([id, name]) => <option key={id} value={id}>{name}（{id}）</option>)}</select></label>
            <fieldset><legend>大宗标志</legend><label><input checked={query.bulkFlag === 'all'} name="unsealed-bulk" onChange={() => updateQuery('bulkFlag', 'all')} type="radio" />全部</label><label><input checked={query.bulkFlag === 'bulk'} name="unsealed-bulk" onChange={() => updateQuery('bulkFlag', 'bulk')} type="radio" />大宗</label><label><input checked={query.bulkFlag === 'single'} name="unsealed-bulk" onChange={() => updateQuery('bulkFlag', 'single')} type="radio" />零散</label></fieldset>
            <label className="mail-handover__date-range"><span>收寄日期</span><span><input aria-label="未封发收寄开始日期" onChange={(event) => updateQuery('acceptedDateFrom', event.target.value)} type="date" value={query.acceptedDateFrom} /><b>至</b><input aria-label="未封发收寄结束日期" onChange={(event) => updateQuery('acceptedDateTo', event.target.value)} type="date" value={query.acceptedDateTo} /></span></label>
          </div>
          <div className="mail-handover__actions">
            <button onClick={() => void runQuery()} type="button">查询</button>
            <button className="mail-handover__action-primary" onClick={openShiftSelection} type="button">总包生成</button>
            <button onClick={() => void refreshDispatchRelations()} type="button">刷新封发关系</button>
            <button onClick={resetQuery} type="button">重置</button>
          </div>
        </section>

        <section aria-label="未封发处理查询结果" className="mail-handover__results">
          <header><span>未封发清单</span><strong>{queryResult.groups.length} 组 / {queryResult.groups.reduce((sum, group) => sum + group.totalItems, 0)} 件</strong></header>
          {queryResult.unconfiguredItems.length > 0 ? (
            <aside aria-label="未维护封发关系" className="customer-notice" role="note">
              <strong>{queryResult.unconfiguredCount} 件邮件尚未维护封发关系，不能生成总包。</strong>
              <p>请由有权的上级人员登录“基础管理 → 封发关系管理”维护；本页不能越权修改。维护完成后点击“刷新封发关系”。</p>
              <ul>{queryResult.unconfiguredItems.map((item) => (
                <li key={item.key}>
                  <span>{item.itemNumber} / {item.product.label} / {destinationZoneLabel(item.destinationZone)}</span>
                </li>
              ))}</ul>
            </aside>
          ) : null}
          <div className="mail-handover__table-wrap">
            <table className="mail-handover__table mail-sealing__table">
              <thead><tr><th><input aria-label="选择全部未封发清单" checked={allPreparedSelected} onChange={toggleAllGroups} type="checkbox" /></th><th>序号</th><th>清单种类代码</th><th>清单种类</th><th>总包接收局</th><th>直封标志</th><th>集散标志</th><th>本转标志</th><th>备注</th><th>清单号码</th><th>件数</th><th>重量(kg)</th><th>空袋重量(kg)</th><th>RFID袋牌号</th><th>操作</th></tr></thead>
              <tbody>
                {queryResult.groups.map((group, index) => {
                  const prepared = preparedManifests[group.key]
                  return (
                    <tr className={selectedGroupKeys.includes(group.key) ? 'mail-sealing__row--selected' : undefined} key={group.key}>
                      <td><input aria-label={`采集清单 ${group.relation.manifestTypeName}`} checked={selectedGroupKeys.includes(group.key)} onChange={() => toggleGroup(group)} type="checkbox" /></td>
                      <td>{index + 1}</td><td>{group.relation.manifestTypeCode}</td><td>{group.relation.manifestTypeName}</td><td>{group.relation.receivingOfficeName}<small>{group.relation.receivingOfficeCode}</small></td><td>{flagLabel(group.relation.directSeal)}</td><td>{flagLabel(group.relation.consolidation)}</td><td>{flagLabel(group.relation.localTransfer)}</td><td>{prepared ? (prepared.usesBarcodeContainer ? '条码容器' : '非条码容器') : '—'}</td><td>{prepared?.manifestNumber ?? '—'}</td><td>{group.totalItems}</td><td>{weightKilograms(group.mailWeightGrams)}</td><td>0.000</td><td>{prepared?.rfidBagTagNumber || '—'}</td><td><button className="mail-sealing__link-button" onClick={() => setDetailGroup(group)} type="button">邮件勾挑</button>{prepared ? <button className="mail-sealing__link-button" onClick={() => openManifestCapture(group)} type="button">修改清单</button> : null}</td>
                    </tr>
                  )
                })}
                {queryResult.groups.length === 0 ? <tr><td colSpan={15}>无数据</td></tr> : null}
              </tbody>
            </table>
          </div>
          {notice ? <p className="customer-notice" role="status">{notice}</p> : null}
          {error && !captureGroup && !shiftOpen && printPromptBags.length === 0 ? <p className="customer-form-error" role="alert">{error}</p> : null}
        </section>
      </div>

      {captureGroup && captureDraft ? (
        <Modal eyebrow="未封发处理" title="获取清单号信息">
          <div className="modal-form mail-handover__modal-form">
            <label><span>是否条码容器</span><select aria-label="是否使用条码容器" onChange={(event) => updateCaptureDraft('usesBarcodeContainer', event.target.value === 'yes')} value={captureDraft.usesBarcodeContainer ? 'yes' : 'no'}><option value="no">否</option><option value="yes">是</option></select></label>
            <label><span>容器</span><select aria-label="封发容器" onChange={(event) => updateCaptureDraft('receptacleType', event.target.value as '1.袋')} value={captureDraft.receptacleType}><option value="1.袋">1.袋</option></select></label>
            <label><span>清单类型</span><input aria-label="封发清单类型" readOnly value={`${captureGroup.relation.manifestTypeName}（${captureGroup.relation.manifestTypeCode}）`} /></label>
            <label><span>清单号码</span><input aria-label="封发清单号码" inputMode="numeric" maxLength={3} onChange={(event) => updateCaptureDraft('manifestNumber', event.target.value.replace(/\D/g, '').slice(0, 3))} value={captureDraft.manifestNumber} /></label>
            {captureDraft.usesBarcodeContainer ? <label><span>容器条码</span><input aria-label="封发容器条码" inputMode="numeric" list="simulated-container-inventory" maxLength={16} onChange={(event) => updateCaptureDraft('containerBarcode', event.target.value.replace(/\D/g, '').slice(0, 16))} value={captureDraft.containerBarcode} /><datalist id="simulated-container-inventory">{SIMULATED_CONTAINER_INVENTORY.map((barcode) => <option key={barcode} value={barcode} />)}</datalist></label> : null}
            <label><span>RFID袋牌号</span><input aria-label="RFID袋牌号" onChange={(event) => updateCaptureDraft('rfidBagTagNumber', event.target.value)} value={captureDraft.rfidBagTagNumber} /></label>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setCaptureGroup(null); setCaptureDraft(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={confirmManifestCapture} type="button">确定</button></div>
          </div>
        </Modal>
      ) : null}

      {detailGroup ? (
        <Modal description={`${detailGroup.relation.manifestTypeName}，共 ${detailGroup.totalItems} 件。`} eyebrow="未封发处理" title="邮件勾挑" wide>
          <div className="mail-sealing__detail-wrap"><table className="mail-handover__table mail-sealing__detail-table"><thead><tr><th>序号</th><th>邮件号码</th><th>业务产品</th><th>有效业务代码</th><th>件数</th><th>重量(g)</th><th>收寄员工</th><th>收寄时间</th></tr></thead><tbody>{detailGroup.items.map((item, index) => <tr key={item.key}><td>{index + 1}</td><td>{item.itemNumber}</td><td>{item.product.label}</td><td>{item.product.effectiveBusinessCode}</td><td>{item.quantity}</td><td>{item.weightGrams}</td><td>{item.operator.displayName}<small>{item.operator.operatorId}</small></td><td>{item.acceptedAt.replace('T', ' ').slice(0, 19)}</td></tr>)}</tbody></table></div>
          <div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => setDetailGroup(null)} type="button">关闭</button></div>
        </Modal>
      ) : null}

      {shiftOpen ? (
        <Modal description={`将生成 ${selectedGroupKeys.length} 个总包。`} eyebrow="未封发处理" title="选择班次">
          <div className="modal-form mail-handover__modal-form"><label><span>班次</span><select aria-label="总包生成班次" onChange={(event) => setShift(event.target.value as DispatchShift)} value={shift}><option value="01">01</option><option value="02">02</option><option value="03">03</option></select></label>{error ? <p className="customer-form-error" role="alert">{error}</p> : null}<div className="modal-actions"><button className="secondary-button" onClick={() => { setShiftOpen(false); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void generateBags()} type="button">确定</button></div></div>
        </Modal>
      ) : null}

      {printPromptBags.length > 0 ? (
        <Modal description={`已生成 ${printPromptBags.length} 个总包。`} eyebrow="未封发处理" title="总包生成成功！是否打印袋牌？">
          <div className="modal-actions"><button className="secondary-button" onClick={() => void recordPrintDecision(false)} type="button">不打印</button><button className="primary-button primary-button--compact" onClick={() => void recordPrintDecision(true)} type="button">打印</button></div>
          {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
        </Modal>
      ) : null}

      {printPreviewBags.length > 0 ? (
        <Modal description={`共 ${printPreviewBags.length} 张袋牌。`} eyebrow="袋牌打印" title="总包袋牌预览" wide>
          <div className="mail-sealing__tag-sheet">
            {printPreviewBags.map((bag) => <article className="mail-sealing__tag" key={bag.id}><header><strong>{bag.manifestTypeName}</strong><span>{bag.manifestTypeCode}</span></header><div className="mail-sealing__tag-barcode" aria-label={`总包条码 ${bag.bagBarcode}`}>{bag.bagBarcode}</div><dl><div><dt>总包接收局</dt><dd>{bag.receivingOfficeName}</dd></div><div><dt>清单号码</dt><dd>{bag.manifestNumber}</dd></div><div><dt>班次</dt><dd>{bag.shift}</dd></div><div><dt>件数</dt><dd>{bag.totalItems}</dd></div><div><dt>重量</dt><dd>{weightKilograms(bag.mailWeightGrams)} kg</dd></div><div><dt>封发员工</dt><dd>{bag.generatedBy.displayName}</dd></div></dl></article>)}
          </div>
          <div className="modal-actions"><button className="secondary-button" onClick={() => setPrintPreviewBags([])} type="button">关闭</button><button className="primary-button primary-button--compact" onClick={() => window.print()} type="button">打印袋牌</button></div>
        </Modal>
      ) : null}
    </>
  )
}
