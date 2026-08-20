import { useMemo, useState, type ReactNode } from 'react'

import {
  BAG_UNLOADING_RELATIONSHIPS,
  BRANCH_EXPORT_RELATIONSHIPS,
  DIRECT_SEAL_RELATIONSHIPS,
  INTERNATIONAL_ORDINARY_EXPORT_RELATIONSHIPS,
  RELATIONSHIP_ORGANIZATIONS,
  localTransferLabel,
  queryAdministrativePostalRelationships,
  queryBagUnloadingRelationships,
  queryBranchExportRelationships,
  queryDirectSealRelationships,
  queryHierarchicalHubRelationships,
  queryNetworkExportRelationships,
  queryPostalRouteComparisons,
  type BagUnloadingRelationshipQuery,
  type BranchExportRelationshipQuery,
  type DirectSealRelationshipQuery,
  type LocalTransferFilter,
  type NetworkExportRelationshipQuery,
  type PostalRouteComparison,
  type PostalRouteComparisonQuery,
} from '../../domain/service/routingRelationshipQuery'
import { SIMULATED_POST_ROUTES } from '../../domain/service/dispatchRouting'
import { Modal } from '../../ui/Modal'

export type RoutingRelationshipSection =
  | 'post-route-comparison'
  | 'network-export-relationship'
  | 'branch-export-relationship'

interface RoutingRelationshipWorkspaceProps {
  onBack: () => void
  section: RoutingRelationshipSection
}

type BranchRelationshipTab =
  | 'branch-export'
  | 'bag-unloading'
  | 'direct-seal'
  | 'international-ordinary'
  | 'administrative-postal'
  | 'hierarchical-hub'

const BRANCH_TABS: readonly { id: BranchRelationshipTab; label: string }[] = [
  { id: 'branch-export', label: '支局出口关系查询' },
  { id: 'bag-unloading', label: '总包卸交站关系查询' },
  { id: 'direct-seal', label: '直封封发关系查询' },
  { id: 'international-ordinary', label: '国际普邮出口关系查询' },
  { id: 'administrative-postal', label: '行政区划邮编对照信息查询' },
  { id: 'hierarchical-hub', label: '层级集散关系查询' },
] as const

function Breadcrumb({ label, onBack }: { label: string; onBack: () => void }) {
  return <div className="customer-breadcrumb"><button onClick={onBack} type="button">主页</button><span>/</span><span>查询</span><span>/</span><strong>{label}</strong></div>
}

function ResultFrame({
  children,
  count,
  label,
}: {
  children: ReactNode
  count: number
  label: string
}) {
  return <section aria-label={`${label}结果`} className="channel-query__results relationship-query__results">
    <div className="channel-query__result-tools"><span>{label}</span><strong>共 {count} 条</strong></div>
    <div className="channel-query__table-wrap">{children}</div>
    <footer className="relationship-query__pager"><button disabled type="button">‹</button><b>1</b><button disabled type="button">›</button><span>跳转至</span><input aria-label={`${label}跳转页码`} disabled value="1" readOnly /><span>页 共 {count} 条 10 条/页</span></footer>
  </section>
}

function EmptyRow({ colSpan, queried }: { colSpan: number; queried: boolean }) {
  return <tr><td className="channel-query__empty" colSpan={colSpan}>{queried ? '无数据' : '请输入条件后查询'}</td></tr>
}

function LocalTransferSelect({
  ariaLabel,
  onChange,
  value,
}: {
  ariaLabel: string
  onChange: (value: LocalTransferFilter) => void
  value: LocalTransferFilter
}) {
  return <select aria-label={ariaLabel} onChange={(event) => onChange(event.target.value as LocalTransferFilter)} value={value}>
    <option value="all">全部</option><option value="local">本转</option><option value="transfer">转口</option><option value="undivided">本转不分</option>
  </select>
}

function PostalRouteComparisonView({ onBack }: { onBack: () => void }) {
  const emptyQuery: PostalRouteComparisonQuery = { organizationTerm: '', validity: 'valid' }
  const [query, setQuery] = useState(emptyQuery)
  const [rows, setRows] = useState<ReturnType<typeof queryPostalRouteComparisons>>([])
  const [queried, setQueried] = useState(false)
  const [detail, setDetail] = useState<PostalRouteComparison | null>(null)

  function runQuery(): void {
    setRows(queryPostalRouteComparisons(query))
    setQueried(true)
  }

  return <>
    <section className="channel-query-workspace relationship-query-workspace">
      <Breadcrumb label="邮路对照查询" onBack={onBack} />
      <section aria-label="邮路对照查询条件" className="channel-query__filters relationship-query__filters">
        <label><span>机构名称</span><input aria-label="邮路对照机构名称" onChange={(event) => setQuery({ ...query, organizationTerm: event.target.value })} value={query.organizationTerm} /></label>
        <label><span>有效标志</span><select aria-label="邮路对照有效标志" onChange={(event) => setQuery({ ...query, validity: event.target.value as PostalRouteComparisonQuery['validity'] })} value={query.validity}><option value="all">全部</option><option value="valid">有效</option><option value="invalid">无效</option></select></label>
        <div className="channel-query__actions"><button className="channel-query__primary" onClick={runQuery} type="button">查询</button><button onClick={() => { setQuery(emptyQuery); setRows([]); setQueried(false) }} type="button">重置</button></div>
      </section>
      <ResultFrame count={rows.length} label="邮路对照信息">
        <table><thead><tr><th>序号</th><th>来源机构代码</th><th>来源机构名称</th><th>邮路代码</th><th>邮路名称</th><th>上下行标识</th><th>有效标志</th><th>操作</th></tr></thead><tbody>
          {rows.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{row.sourceInstitutionCode}</td><td>{row.sourceInstitutionName}</td><td>{row.routeCode}</td><td>{row.routeName}</td><td>{row.direction}</td><td>{row.valid ? '有效' : '无效'}</td><td><button onClick={() => setDetail(row)} type="button">邮路站序详情</button></td></tr>)}
          {rows.length === 0 ? <EmptyRow colSpan={8} queried={queried} /> : null}
        </tbody></table>
      </ResultFrame>
    </section>
    {detail ? <Modal description={`${detail.routeCode} ${detail.routeName}`} eyebrow="邮路对照查询" title="邮路站序详情" wide><div className="modal-form relationship-query__detail"><div className="channel-query__table-wrap"><table><thead><tr><th>序号</th><th>机构代码</th><th>机构名称</th><th>段落级别</th><th>所属机构代码</th><th>所属机构名称</th></tr></thead><tbody>{detail.stations.map((station) => <tr key={`${detail.id}:${station.sequence}`}><td>{station.sequence}</td><td>{station.institutionCode}</td><td>{station.institutionName}</td><td>{station.segmentLevel}</td><td>{station.owningInstitutionCode}</td><td>{station.owningInstitutionName}</td></tr>)}</tbody></table></div><div className="modal-actions"><button className="primary-button primary-button--compact" onClick={() => setDetail(null)} type="button">关闭</button></div></div></Modal> : null}
  </>
}

function NetworkExportRelationshipView({ onBack }: { onBack: () => void }) {
  const emptyQuery: NetworkExportRelationshipQuery = { institutionCode: '99901001', productStart: '', localTransfer: 'all', receivingOfficeCode: '', routeTerm: '' }
  const [query, setQuery] = useState(emptyQuery)
  const [rows, setRows] = useState<ReturnType<typeof queryNetworkExportRelationships>>([])
  const [queried, setQueried] = useState(false)

  function runQuery(): void {
    setRows(queryNetworkExportRelationships(query))
    setQueried(true)
  }

  return <section className="channel-query-workspace relationship-query-workspace">
    <Breadcrumb label="网运出口关系查询" onBack={onBack} />
    <section aria-label="网运出口关系查询条件" className="channel-query__filters relationship-query__filters relationship-query__filters--network">
      <label><span>机构代码</span><select aria-label="网运机构代码" onChange={(event) => setQuery({ ...query, institutionCode: event.target.value })} value={query.institutionCode}><option value="">全部</option>{RELATIONSHIP_ORGANIZATIONS.map((organization) => <option key={organization.code} value={organization.code}>{organization.code} {organization.name}</option>)}</select></label>
      <label><span>邮件种类</span><select aria-label="网运邮件种类" onChange={(event) => setQuery({ ...query, productStart: event.target.value as NetworkExportRelationshipQuery['productStart'] })} value={query.productStart}><option value="">全部</option><option value="1">1 开头</option><option value="2">2 开头</option><option value="3">3 开头</option><option value="4">4 开头</option></select></label>
      <label><span>本转标志</span><LocalTransferSelect ariaLabel="网运本转标志" onChange={(value) => setQuery({ ...query, localTransfer: value })} value={query.localTransfer} /></label>
      <label><span>接收局代码</span><input aria-label="网运接收局代码" onChange={(event) => setQuery({ ...query, receivingOfficeCode: event.target.value })} value={query.receivingOfficeCode} /></label>
      <label><span>邮路</span><input aria-label="网运邮路" onChange={(event) => setQuery({ ...query, routeTerm: event.target.value })} value={query.routeTerm} /></label>
      <div className="channel-query__actions"><button className="channel-query__primary" onClick={runQuery} type="button">查询</button><button onClick={() => { setQuery(emptyQuery); setRows([]); setQueried(false) }} type="button">重置</button></div>
    </section>
    <ResultFrame count={rows.length} label="网运出口关系信息">
      <table><thead><tr><th>序号</th><th>机构代码</th><th>机构名称</th><th>邮件种类</th><th>邮路</th><th>接收局代码</th><th>接收局名称</th><th>本转标志</th><th>下发日期</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{row.institutionCode}</td><td>{row.institutionName}</td><td>{row.productStart} / {row.mailKindName}</td><td>{row.routeCode}<small>{row.routeName}</small></td><td>{row.receivingOfficeCode}</td><td>{row.receivingOfficeName}</td><td>{localTransferLabel(row.localTransfer)}</td><td>{row.issuedDate}</td></tr>)}{rows.length === 0 ? <EmptyRow colSpan={9} queried={queried} /> : null}</tbody></table>
    </ResultFrame>
  </section>
}

function BranchExportTab() {
  const emptyQuery: BranchExportRelationshipQuery = { institutionCode: '99901001', productTerm: '', openingOfficeCode: '', destinationPostalAreaCode: '', localTransfer: 'all', deletionFlag: 'active' }
  const [query, setQuery] = useState(emptyQuery)
  const [rows, setRows] = useState<ReturnType<typeof queryBranchExportRelationships>>([])
  const [queried, setQueried] = useState(false)
  const products = useMemo(() => Array.from(new Map(BRANCH_EXPORT_RELATIONSHIPS.map((row) => [row.baseProductCode, row.baseProductName])).entries()), [])

  function runQuery(): void { setRows(queryBranchExportRelationships(query)); setQueried(true) }
  return <>
    <section aria-label="支局出口关系查询条件" className="channel-query__filters relationship-query__filters">
      <label><span>查询机构</span><select aria-label="支局出口查询机构" onChange={(event) => setQuery({ ...query, institutionCode: event.target.value })} value={query.institutionCode}><option value="">全部</option>{RELATIONSHIP_ORGANIZATIONS.map((organization) => <option key={organization.code} value={organization.code}>{organization.code} {organization.name}</option>)}</select></label>
      <label><span>业务产品</span><select aria-label="支局出口业务产品" onChange={(event) => setQuery({ ...query, productTerm: event.target.value })} value={query.productTerm}><option value="">全部</option>{products.map(([code, name]) => <option key={code} value={code}>{code} {name}</option>)}</select></label>
      <label><span>本转标志</span><LocalTransferSelect ariaLabel="支局出口本转标志" onChange={(value) => setQuery({ ...query, localTransfer: value })} value={query.localTransfer} /></label>
      <label><span>开拆局代码</span><input aria-label="支局出口开拆局代码" onChange={(event) => setQuery({ ...query, openingOfficeCode: event.target.value })} value={query.openingOfficeCode} /></label>
      <label><span>寄达邮区代码</span><input aria-label="支局出口寄达邮区代码" onChange={(event) => setQuery({ ...query, destinationPostalAreaCode: event.target.value })} value={query.destinationPostalAreaCode} /></label>
      <label><span>删除标志</span><select aria-label="支局出口删除标志" onChange={(event) => setQuery({ ...query, deletionFlag: event.target.value as BranchExportRelationshipQuery['deletionFlag'] })} value={query.deletionFlag}><option value="all">全部</option><option value="active">否</option><option value="deleted">是</option></select></label>
      <div className="channel-query__actions"><button className="channel-query__primary" onClick={runQuery} type="button">查询</button><button onClick={() => { setQuery(emptyQuery); setRows([]); setQueried(false) }} type="button">重置</button></div>
    </section>
    <ResultFrame count={rows.length} label="支局出口关系信息"><table><thead><tr><th>序号</th><th>机构代码</th><th>机构名称</th><th>基础产品代码</th><th>基础产品名称</th><th>开拆局代码</th><th>开拆局名称</th><th>寄达邮区代码</th><th>寄达邮区名称</th><th>本转标志</th><th>删除标志</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{row.institutionCode}</td><td>{row.institutionName}</td><td>{row.baseProductCode}</td><td>{row.baseProductName}</td><td>{row.openingOfficeCode}</td><td>{row.openingOfficeName}</td><td>{row.destinationPostalAreaCode}</td><td>{row.destinationPostalAreaName}</td><td>{localTransferLabel(row.localTransfer)}</td><td>{row.deleted ? '是' : '否'}</td></tr>)}{rows.length === 0 ? <EmptyRow colSpan={11} queried={queried} /> : null}</tbody></table></ResultFrame>
  </>
}

function BagUnloadingTab() {
  const emptyQuery: BagUnloadingRelationshipQuery = { institutionCode: '99901001', bagTypeTerm: '', routeCode: '', receivingOfficeCode: '', unloadingStationCode: '', localTransfer: 'all' }
  const [query, setQuery] = useState(emptyQuery)
  const [rows, setRows] = useState<ReturnType<typeof queryBagUnloadingRelationships>>([])
  const [queried, setQueried] = useState(false)
  function runQuery(): void { setRows(queryBagUnloadingRelationships(query)); setQueried(true) }
  return <>
    <section aria-label="总包卸交站关系查询条件" className="channel-query__filters relationship-query__filters">
      <label><span>机构</span><select aria-label="卸交站机构" onChange={(event) => setQuery({ ...query, institutionCode: event.target.value })} value={query.institutionCode}><option value="">全部</option>{RELATIONSHIP_ORGANIZATIONS.map((organization) => <option key={organization.code} value={organization.code}>{organization.code} {organization.name}</option>)}</select></label>
      <label><span>总包清单种类</span><select aria-label="卸交站总包清单种类" onChange={(event) => setQuery({ ...query, bagTypeTerm: event.target.value })} value={query.bagTypeTerm}><option value="">全部</option>{BAG_UNLOADING_RELATIONSHIPS.map((row) => <option key={row.id} value={row.bagTypeCode}>{row.bagTypeCode} {row.bagTypeName}</option>)}</select></label>
      <label><span>邮路代码</span><select aria-label="卸交站邮路代码" onChange={(event) => setQuery({ ...query, routeCode: event.target.value })} value={query.routeCode}><option value="">全部</option>{SIMULATED_POST_ROUTES.map((route) => <option key={route.code} value={route.code}>{route.code} {route.name}</option>)}</select></label>
      <label><span>接收局代码</span><input aria-label="卸交站接收局代码" onChange={(event) => setQuery({ ...query, receivingOfficeCode: event.target.value })} value={query.receivingOfficeCode} /></label>
      <label><span>卸交站代码</span><input aria-label="卸交站代码" onChange={(event) => setQuery({ ...query, unloadingStationCode: event.target.value })} value={query.unloadingStationCode} /></label>
      <label><span>本转标志</span><LocalTransferSelect ariaLabel="卸交站本转标志" onChange={(value) => setQuery({ ...query, localTransfer: value })} value={query.localTransfer} /></label>
      <div className="channel-query__actions"><button className="channel-query__primary" onClick={runQuery} type="button">查询</button><button onClick={() => { setQuery(emptyQuery); setRows([]); setQueried(false) }} type="button">重置</button></div>
    </section>
    <ResultFrame count={rows.length} label="总包卸交站关系信息"><table><thead><tr><th>序号</th><th>机构代码</th><th>机构名称</th><th>总包清单种类代码</th><th>总包清单种类名称</th><th>邮路代码</th><th>接收局代码</th><th>卸交站代码</th><th>卸交站名称</th><th>本转标志</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{row.institutionCode}</td><td>{row.institutionName}</td><td>{row.bagTypeCode}</td><td>{row.bagTypeName}</td><td>{row.routeCode}</td><td>{row.receivingOfficeCode}</td><td>{row.unloadingStationCode}</td><td>{row.unloadingStationName}</td><td>{localTransferLabel(row.localTransfer)}</td></tr>)}{rows.length === 0 ? <EmptyRow colSpan={10} queried={queried} /> : null}</tbody></table></ResultFrame>
  </>
}

function DirectSealTab() {
  const emptyQuery: DirectSealRelationshipQuery = { provinceName: '', prefectureName: '', countyName: '' }
  const [query, setQuery] = useState(emptyQuery)
  const [rows, setRows] = useState<ReturnType<typeof queryDirectSealRelationships>>([])
  const [queried, setQueried] = useState(false)
  const provinces = useMemo(() => Array.from(new Set(DIRECT_SEAL_RELATIONSHIPS.map((row) => row.provinceName))), [])
  const prefectures = useMemo(() => Array.from(new Set(DIRECT_SEAL_RELATIONSHIPS.filter((row) => !query.provinceName || row.provinceName === query.provinceName).map((row) => row.prefectureName))), [query.provinceName])
  const counties = useMemo(() => Array.from(new Set(DIRECT_SEAL_RELATIONSHIPS.filter((row) => (!query.provinceName || row.provinceName === query.provinceName) && (!query.prefectureName || row.prefectureName === query.prefectureName)).map((row) => row.countyName))), [query.prefectureName, query.provinceName])
  function runQuery(): void { setRows(queryDirectSealRelationships(query)); setQueried(true) }
  return <>
    <section aria-label="直封封发关系查询条件" className="channel-query__filters relationship-query__filters">
      <label><span>省份</span><select aria-label="直封省份" onChange={(event) => setQuery({ provinceName: event.target.value, prefectureName: '', countyName: '' })} value={query.provinceName}><option value="">全部</option>{provinces.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label><span>地市</span><select aria-label="直封地市" onChange={(event) => setQuery({ ...query, prefectureName: event.target.value, countyName: '' })} value={query.prefectureName}><option value="">全部</option>{prefectures.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label><span>区县</span><select aria-label="直封区县" onChange={(event) => setQuery({ ...query, countyName: event.target.value })} value={query.countyName}><option value="">全部</option>{counties.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <div className="channel-query__actions"><button className="channel-query__primary" onClick={runQuery} type="button">查询</button><button onClick={() => { setQuery(emptyQuery); setRows([]); setQueried(false) }} type="button">重置</button></div>
    </section>
    <ResultFrame count={rows.length} label="直封封发关系信息"><table><thead><tr><th>序号</th><th>省份</th><th>地市</th><th>区县</th><th>行政区划代码</th><th>总包接收局代码</th><th>总包接收局名称</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{row.provinceName}</td><td>{row.prefectureName}</td><td>{row.countyName}</td><td>{row.administrativeCode}</td><td>{row.bagReceivingOfficeCode}</td><td>{row.bagReceivingOfficeName}</td></tr>)}{rows.length === 0 ? <EmptyRow colSpan={7} queried={queried} /> : null}</tbody></table></ResultFrame>
  </>
}

function InternationalOrdinaryTab() {
  const rows = INTERNATIONAL_ORDINARY_EXPORT_RELATIONSHIPS
  return <ResultFrame count={rows.length} label="国际普邮出口关系信息"><table><thead><tr><th>序号</th><th>省份代码</th><th>国际邮件代码</th><th>寄达国家代码</th><th>接收局名</th><th>生效日期</th><th>终止日期</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{row.provinceCode}</td><td>{row.internationalMailCode}</td><td>{row.destinationCountryCode}</td><td>{row.receivingOfficeName}</td><td>{row.effectiveDate}</td><td>{row.expiryDate}</td></tr>)}</tbody></table></ResultFrame>
}

function AdministrativePostalTab() {
  const [code, setCode] = useState('')
  const [rows, setRows] = useState<ReturnType<typeof queryAdministrativePostalRelationships>>([])
  const [queried, setQueried] = useState(false)
  const [error, setError] = useState('')
  function runQuery(): void {
    try { setRows(queryAdministrativePostalRelationships(code)); setQueried(true); setError('') }
    catch (caught) { setRows([]); setQueried(false); setError(caught instanceof Error ? caught.message : '查询失败。') }
  }
  return <>
    <section aria-label="行政区划邮编对照信息查询条件" className="channel-query__filters relationship-query__filters relationship-query__filters--code">
      <label><span>行政区划代码</span><input aria-label="行政区划代码" inputMode="numeric" maxLength={6} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} value={code} /></label>
      <div className="channel-query__actions"><button className="channel-query__primary" onClick={runQuery} type="button">查询</button><button onClick={() => { setCode(''); setRows([]); setQueried(false); setError('') }} type="button">重置</button></div>
    </section>
    {error ? <p className="customer-form-error relationship-query__error" role="alert">{error}</p> : null}
    <ResultFrame count={rows.length} label="行政区划邮编对照信息"><table><thead><tr><th>序号</th><th>行政区划代码</th><th>行政区划名称</th><th>区域代码</th><th>区域名称</th><th>区域级别</th><th>邮编起始</th><th>邮编终止</th><th>邮政局代码</th><th>邮政局名称</th><th>上级行政区划代码</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{row.administrativeCode}</td><td>{row.administrativeName}</td><td>{row.regionCode}</td><td>{row.regionName}</td><td>{row.regionLevel}</td><td>{row.postalCodeStart}</td><td>{row.postalCodeEnd}</td><td>{row.postalOfficeCode}</td><td>{row.postalOfficeName}</td><td>{row.parentAdministrativeCode}</td></tr>)}{rows.length === 0 ? <EmptyRow colSpan={11} queried={queried} /> : null}</tbody></table></ResultFrame>
  </>
}

function HierarchicalHubTab() {
  const [code, setCode] = useState('')
  const [rows, setRows] = useState<ReturnType<typeof queryHierarchicalHubRelationships>>([])
  const [queried, setQueried] = useState(false)
  const [error, setError] = useState('')
  function runQuery(): void {
    try { setRows(queryHierarchicalHubRelationships(code)); setQueried(true); setError('') }
    catch (caught) { setRows([]); setQueried(false); setError(caught instanceof Error ? caught.message : '查询失败。') }
  }
  return <>
    <section aria-label="层级集散关系查询条件" className="channel-query__filters relationship-query__filters relationship-query__filters--code">
      <label><span>投递局区域码</span><input aria-label="投递局区域码" inputMode="numeric" maxLength={8} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))} value={code} /></label>
      <div className="channel-query__actions"><button className="channel-query__primary" onClick={runQuery} type="button">查询</button><button onClick={() => { setCode(''); setRows([]); setQueried(false); setError('') }} type="button">重置</button></div>
    </section>
    {error ? <p className="customer-form-error relationship-query__error" role="alert">{error}</p> : null}
    <ResultFrame count={rows.length} label="层级集散关系信息"><table><thead><tr><th>序号</th><th>当前机构代码</th><th>当前机构名称</th><th>机构级别</th><th>省级机构代码</th><th>省级机构名称</th><th>地市机构代码</th><th>地市机构名称</th><th>上级机构代码</th><th>上级机构名称</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{row.institutionCode}</td><td>{row.institutionName}</td><td>{row.level}</td><td>{row.provinceInstitutionCode}</td><td>{row.provinceInstitutionName}</td><td>{row.prefectureInstitutionCode}</td><td>{row.prefectureInstitutionName}</td><td>{row.parentInstitutionCode}</td><td>{row.parentInstitutionName}</td></tr>)}{rows.length === 0 ? <EmptyRow colSpan={10} queried={queried} /> : null}</tbody></table></ResultFrame>
  </>
}

function BranchExportRelationshipView({ onBack }: { onBack: () => void }) {
  const [activeTab, setActiveTab] = useState<BranchRelationshipTab>('branch-export')
  return <section className="channel-query-workspace relationship-query-workspace">
    <Breadcrumb label="寄递支局出口关系查询" onBack={onBack} />
    <nav aria-label="寄递支局出口关系页签" className="relationship-query__tabs">{BRANCH_TABS.map((tab) => <button aria-current={activeTab === tab.id ? 'page' : undefined} key={tab.id} onClick={() => setActiveTab(tab.id)} type="button">{tab.label}</button>)}</nav>
    {activeTab === 'branch-export' ? <BranchExportTab /> : activeTab === 'bag-unloading' ? <BagUnloadingTab /> : activeTab === 'direct-seal' ? <DirectSealTab /> : activeTab === 'international-ordinary' ? <InternationalOrdinaryTab /> : activeTab === 'administrative-postal' ? <AdministrativePostalTab /> : <HierarchicalHubTab />}
  </section>
}

export function RoutingRelationshipWorkspace({
  onBack,
  section,
}: RoutingRelationshipWorkspaceProps) {
  if (section === 'post-route-comparison') return <PostalRouteComparisonView onBack={onBack} />
  if (section === 'network-export-relationship') return <NetworkExportRelationshipView onBack={onBack} />
  return <BranchExportRelationshipView onBack={onBack} />
}
