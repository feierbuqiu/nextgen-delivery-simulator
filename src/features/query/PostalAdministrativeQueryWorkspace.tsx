import { useState } from 'react'

import {
  queryPostalAdministrativeDivisions,
  type PostalAdministrativeQueryMethod,
  type PostalAdministrativeQueryRow,
} from '../../domain/service/postalAdministrativeQuery'

interface PostalAdministrativeQueryWorkspaceProps {
  onBack: () => void
}

function Breadcrumb({ onBack }: { onBack: () => void }) {
  return <div className="customer-breadcrumb">
    <button onClick={onBack} type="button">主页</button>
    <span>/</span>
    <span>查询</span>
    <span>/</span>
    <strong>邮编行政区划查询</strong>
  </div>
}

function matchedByTitle(row: PostalAdministrativeQueryRow): string {
  if (row.matchedBy === 'gis') return 'GIS 匹配'
  if (row.matchedBy === 'administrative-fallback') return 'GIS 未命中，由营业渠道行政区划匹配'
  if (row.matchedBy === 'administrative') return '营业渠道行政区划匹配'
  return '未匹配到现行虚构行政区划'
}

export function PostalAdministrativeQueryWorkspace({
  onBack,
}: PostalAdministrativeQueryWorkspaceProps) {
  const [addresses, setAddresses] = useState('')
  const [rows, setRows] = useState<PostalAdministrativeQueryRow[]>([])
  const [queried, setQueried] = useState(false)
  const [error, setError] = useState('')

  function runQuery(method: PostalAdministrativeQueryMethod): void {
    try {
      setRows(queryPostalAdministrativeDivisions(addresses, method))
      setQueried(true)
      setError('')
    } catch (caught) {
      setRows([])
      setQueried(false)
      setError(caught instanceof Error ? caught.message : '邮编行政区划查询失败。')
    }
  }

  return <section className="channel-query-workspace relationship-query-workspace postal-admin-query-workspace">
    <Breadcrumb onBack={onBack} />
    <section aria-label="邮编行政区划查询条件" className="postal-admin-query__input">
      <textarea
        aria-label="邮件详细地址信息"
        onChange={(event) => setAddresses(event.target.value)}
        placeholder="请输入地址信息，按回车换行，一次最多支持100条查询"
        rows={5}
        value={addresses}
      />
      <div className="postal-admin-query__actions">
        <button onClick={() => runQuery('gis')} type="button">查询(GIS)</button>
        <button onClick={() => runQuery('administrative')} type="button">查询(行政区划匹配)</button>
      </div>
    </section>

    {error ? <p className="customer-form-error relationship-query__error" role="alert">{error}</p> : null}

    {queried ? <section aria-label="邮编行政区划查询结果" className="channel-query__results relationship-query__results postal-admin-query__results">
      <div className="channel-query__result-tools">
        <span>邮编行政区划查询结果</span>
        <strong>共 {rows.length} 条</strong>
      </div>
      <div className="channel-query__table-wrap">
        <table>
          <thead><tr>
            <th>序号</th>
            <th>查询结果</th>
            <th>行政区划</th>
            <th>完整地址描述</th>
            <th>省编码</th>
            <th>省名称</th>
            <th>地市编码</th>
            <th>地市名称</th>
            <th>区县编码</th>
            <th>区县名称</th>
            <th>邮政编码</th>
          </tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={row.id} title={matchedByTitle(row)}>
              <td>{index + 1}</td>
              <td className={row.queryResult === '查询成功' ? 'postal-admin-query__success' : 'postal-admin-query__failure'}>{row.queryResult}</td>
              <td>{row.administrativeCode}</td>
              <td>{row.fullAddressDescription || row.inputAddress}</td>
              <td>{row.provinceCode}</td>
              <td>{row.provinceName}</td>
              <td>{row.prefectureCode}</td>
              <td>{row.prefectureName}</td>
              <td>{row.countyCode}</td>
              <td>{row.countyName}</td>
              <td>{row.postalCode}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section> : null}
  </section>
}
