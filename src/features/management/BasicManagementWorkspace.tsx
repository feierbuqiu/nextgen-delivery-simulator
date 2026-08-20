import { useEffect, useMemo, useState } from 'react'

import {
  DEFAULT_OPERATOR_PROFILE,
  REQUESTABLE_ROLE_IDS,
} from '../../domain/access/catalog'
import {
  accessibleInstitutionCodes,
  hasPermission,
  roleNamesForOperator,
} from '../../domain/access/authorization'
import {
  submitDeactivationRequest,
  submitNewEmployeeRequest,
  submitProfileChangeRequest,
  submitRoleRequest,
} from '../../domain/access/management'
import { authorizeDispatchRelationManagement } from '../../domain/access/workAuthorization'
import type {
  DemoOperator,
  OperatorProfile,
  PersonnelType,
  SimulatorState,
} from '../../domain/access/types'
import { SIMULATED_POST_ROUTES } from '../../domain/service/dispatchRouting'
import {
  DISPATCH_RELATION_MANIFEST_OPTIONS,
  dispatchRelationForMail,
  dispatchRelationOverrideKey,
  queryAvailableUnsealedMail,
  SIMULATED_DISPATCH_RECEIVERS,
  type UnsealedMailItem,
} from '../../domain/service/mailSealing'
import type { ServiceRepository } from '../../domain/service/repository'
import { serviceOperatorInstitutionCode } from '../../domain/service/institutionScope'
import type { ServiceWorkspaceState } from '../../domain/service/types'
import { Modal } from '../../ui/Modal'

interface BasicManagementWorkspaceProps {
  onBack: () => void
  onStateChange: (state: SimulatorState) => Promise<void>
  repository: ServiceRepository
  state: SimulatorState
}

interface RelationDraft {
  item: UnsealedMailItem
  manifestTypeCode: string
  routeCode: string
  directSeal: boolean
  consolidation: boolean
  localTransfer: boolean
  acknowledged: boolean
}

function destinationZoneLabel(zone: UnsealedMailItem['destinationZone']): string {
  return zone === 'local' ? '本埠' : zone === 'nonlocal' ? '国内异地' : '境外'
}

function defaultRelationRoute(zone: UnsealedMailItem['destinationZone']): string {
  return zone === 'local' ? 'SIM-B02' : zone === 'nonlocal' ? 'SIM-A01' : 'SIM-C03'
}

type Editor =
  | { mode: 'new'; operatorId: string; mobile: string; profile: OperatorProfile; reason: string }
  | { mode: 'edit'; operator: DemoOperator; profile: OperatorProfile; reason: string }
  | { mode: 'role'; operator: DemoOperator; roleId: string; reason: string }
  | { mode: 'deactivate'; operator: DemoOperator; reason: string }

function personnelStatusLabel(operator: DemoOperator): string {
  if (operator.accountStatus === 'disabled') return '账户停用'
  if (operator.profile?.personnelStatus === 'active') return '在岗'
  if (operator.profile?.personnelStatus === 'seconded') return '借调'
  return '离岗'
}

export function BasicManagementWorkspace({
  onBack,
  onStateChange,
  repository,
  state,
}: BasicManagementWorkspaceProps) {
  const canManagePersonnel = hasPermission(state, 'management.basic.personnel')
  const canReadRoles = hasPermission(state, 'management.basic.roles')
  const canManageRelations = hasPermission(state, 'management.basic.dispatch-relations')
  const [section, setSection] = useState<'personnel' | 'roles' | 'dispatch-relations'>(() => (
    canManagePersonnel ? 'personnel' : canManageRelations ? 'dispatch-relations' : 'roles'
  ))
  const ownInstitutionCode = state.operator.profile?.institutionCode ?? '99901001'
  const [institutionCode, setInstitutionCode] = useState(ownInstitutionCode)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [serviceWorkspace, setServiceWorkspace] = useState<ServiceWorkspaceState | null>(null)
  const [relationDraft, setRelationDraft] = useState<RelationDraft | null>(null)
  const [relationBusy, setRelationBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const relationInstitutionCodes = useMemo(() => accessibleInstitutionCodes(
    state,
    'management.basic.dispatch-relations',
  ), [state])

  useEffect(() => {
    if (!canManageRelations) return
    let active = true
    void repository.load().then((loaded) => {
      if (active) setServiceWorkspace(loaded)
    }).catch(() => {
      if (active) setError('封发关系数据读取失败。')
    })
    return () => { active = false }
  }, [canManageRelations, repository])

  const missingRelations = useMemo(() => {
    if (!serviceWorkspace) return []
    const unique = new Map<string, UnsealedMailItem>()
    for (const targetInstitutionCode of relationInstitutionCodes) {
      for (const item of queryAvailableUnsealedMail(serviceWorkspace, targetInstitutionCode)) {
        if (dispatchRelationForMail(item, serviceWorkspace.dispatchRelationOverrides)) continue
        const key = dispatchRelationOverrideKey(
          item.product.id,
          item.destinationZone,
          item.bulk,
          targetInstitutionCode,
        )
        if (!unique.has(key)) unique.set(key, item)
      }
    }
    return [...unique.values()]
  }, [relationInstitutionCodes, serviceWorkspace])
  const maintainedRelations = useMemo(() => (
    serviceWorkspace?.dispatchRelationOverrides.filter((relation) =>
      relationInstitutionCodes.has(relation.institutionCode)) ?? []
  ), [relationInstitutionCodes, serviceWorkspace])
  const relationInstitutionLabel = (code: string) => {
    const institution = state.institutions.find((candidate) => candidate.code === code)
    return institution ? `${institution.name}（${code}）` : code
  }
  const relationRoute = relationDraft
    ? SIMULATED_POST_ROUTES.find((route) => route.code === relationDraft.routeCode)
    : undefined
  const relationReceiver = relationRoute
    ? SIMULATED_DISPATCH_RECEIVERS.find((receiver) => (
        relationRoute.receivingOfficeCodes.includes(receiver.code)
      ))
    : undefined

  const accessibleInstitutions = useMemo(() => {
    const codes = accessibleInstitutionCodes(state, 'management.basic.personnel')
    return state.institutions.filter((institution) => (
      institution.status === 'active' && codes.has(institution.code)
    ))
  }, [state])
  const employees = state.operators.filter((operator) => (
    operator.profile?.institutionCode === institutionCode
  ))
  const pendingCount = state.personnelRequests.filter((request) => request.status === 'pending').length

  function openNewEmployee(): void {
    const institution = state.institutions.find((item) => item.code === institutionCode)
    setEditor({
      mode: 'new',
      operatorId: '80000002',
      mobile: '10000000017',
      profile: {
        ...structuredClone(DEFAULT_OPERATOR_PROFILE),
        displayName: '新员工',
        nameAbbreviation: 'XYG',
        identityCode: '990101199501010013',
        birthDate: '1995-01-01',
        phone: '10000000017',
        institutionCode,
        institutionName: institution?.name ?? '景麓营业部',
        employedDate: '2026-08-12',
        serviceYears: '0年',
        arrivalDate: '2026-08-12',
      },
      reason: '',
    })
    setError('')
  }

  async function submitEditor(): Promise<void> {
    if (!editor) return
    try {
      const now = new Date().toISOString()
      let next: SimulatorState
      if (editor.mode === 'new') {
        next = submitNewEmployeeRequest(state, {
          id: editor.operatorId,
          boundMobile: editor.mobile,
          requiresWorkstation: true,
          profile: { ...editor.profile, phone: editor.mobile },
        }, editor.reason, now)
      } else if (editor.mode === 'edit') {
        next = submitProfileChangeRequest(
          state,
          editor.operator.id,
          editor.profile,
          editor.reason,
          now,
        )
      } else if (editor.mode === 'role') {
        if (!editor.roleId) throw new Error('请选择需要申请的专项权限。')
        next = submitRoleRequest(
          state,
          editor.roleId,
          editor.reason,
          now,
          editor.operator.id,
        )
      } else {
        next = submitDeactivationRequest(
          state,
          editor.operator.id,
          editor.reason,
          now,
        )
      }
      await onStateChange(next)
      setEditor(null)
      setMessage('人员申请已提交，请到业务管理的人员审批中处理。')
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '人员申请提交失败。')
    }
  }

  function openRelationEditor(item: UnsealedMailItem): void {
    setRelationDraft({
      item,
      manifestTypeCode: '',
      routeCode: defaultRelationRoute(item.destinationZone),
      directSeal: false,
      consolidation: item.destinationZone === 'nonlocal',
      localTransfer: item.destinationZone === 'local',
      acknowledged: false,
    })
    setMessage('')
    setError('')
  }

  async function saveDispatchRelation(): Promise<void> {
    if (!relationDraft || !serviceWorkspace || relationBusy) return
    const manifest = DISPATCH_RELATION_MANIFEST_OPTIONS.find(
      (candidate) => candidate.code === relationDraft.manifestTypeCode,
    )
    const route = SIMULATED_POST_ROUTES.find(
      (candidate) => candidate.code === relationDraft.routeCode,
    )
    const receiver = route
      ? SIMULATED_DISPATCH_RECEIVERS.find((candidate) => (
          route.receivingOfficeCodes.includes(candidate.code)
        ))
      : undefined
    if (!manifest) {
      setError('请选择清单种类。')
      return
    }
    if (!route || !receiver) {
      setError('请选择能够到达总包接收局的邮路。')
      return
    }
    if (!relationDraft.acknowledged) {
      setError('请由当前登录的上级经办人员人工核对关系内容。')
      return
    }
    setRelationBusy(true)
    setError('')
    try {
      const updatedAt = new Date().toISOString()
      const targetInstitutionCode = serviceOperatorInstitutionCode(relationDraft.item.operator)
      const accessResult = authorizeDispatchRelationManagement(
        state,
        targetInstitutionCode,
        updatedAt,
      )
      await onStateChange(accessResult.state)
      const result = await repository.executeMailSealing({
        type: 'upsert-dispatch-relation',
        product: relationDraft.item.product,
        destinationZone: relationDraft.item.destinationZone,
        bulk: relationDraft.item.bulk,
        manifestTypeCode: manifest.code,
        routeCode: route.code,
        receivingOfficeCode: receiver.code,
        directSeal: relationDraft.directSeal,
        consolidation: relationDraft.consolidation,
        localTransfer: relationDraft.localTransfer,
        institutionCode: targetInstitutionCode,
        updatedAt,
        operator: {
          operatorId: state.operator.id,
          displayName: state.operator.profile?.displayName ?? state.operator.id,
          workstationCode: state.session?.workstationCode ?? '管理端',
          acceptanceOffice: state.operator.profile?.institutionName ?? '上级管理机构',
          receivingOffice: '',
          institutionCode: state.operator.profile?.institutionCode,
        },
        authorization: accessResult.authorization,
      })
      setServiceWorkspace(result.state)
      setRelationDraft(null)
      setMessage(`封发关系已保存：${relationDraft.item.product.label} / ${destinationZoneLabel(relationDraft.item.destinationZone)}。网点刷新后即可使用。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '封发关系保存失败。')
    } finally {
      setRelationBusy(false)
    }
  }

  async function refreshDispatchRelations(): Promise<void> {
    try {
      setServiceWorkspace(await repository.load())
      setMessage('封发关系数据已刷新。')
      setError('')
    } catch {
      setError('封发关系数据读取失败。')
    }
  }

  if (!canManagePersonnel && !canReadRoles && !canManageRelations) {
    return <section aria-label="无权访问基础管理" className="management-workspace management-denied"><h1>无权访问</h1><p>当前岗位没有基础管理权限。</p><button onClick={onBack} type="button">返回主页</button></section>
  }

  return (
    <>
      <section aria-label="基础管理" className="management-workspace">
        <div className="customer-breadcrumb"><button onClick={onBack} type="button">主页</button><span>/</span><strong>基础管理</strong></div>
        <header className="management-heading"><div><h1>系统管理</h1><p>人员、角色与封发关系管理</p></div><span>待审批 {pendingCount}</span></header>
        <nav aria-label="基础管理栏目" className="management-tabs">
          {canManagePersonnel ? <button aria-current={section === 'personnel' ? 'page' : undefined} onClick={() => setSection('personnel')} type="button">人员管理</button> : null}
          {canReadRoles ? <button aria-current={section === 'roles' ? 'page' : undefined} onClick={() => setSection('roles')} type="button">角色管理</button> : null}
          {canManageRelations ? <button aria-current={section === 'dispatch-relations' ? 'page' : undefined} onClick={() => setSection('dispatch-relations')} type="button">封发关系管理</button> : null}
        </nav>

        {message ? <p className="customer-form-success" role="status">{message}</p> : null}
        {error && !editor && !relationDraft ? <p className="customer-form-error" role="alert">{error}</p> : null}

        {section === 'personnel' ? (
          <div className="personnel-management-layout">
            <aside aria-label="机构树" className="institution-tree">
              <h2>机构列表</h2>
              {accessibleInstitutions.map((institution) => <button aria-current={institutionCode === institution.code ? 'page' : undefined} key={institution.code} onClick={() => setInstitutionCode(institution.code)} type="button"><span>▾</span><span>{institution.name}</span><small>{institution.code}</small></button>)}
            </aside>
            <section aria-label="员工列表" className="management-panel management-table-wrap">
              <div className="management-toolbar"><div><label><span>机构</span><select aria-label="人员查询机构" onChange={(event) => setInstitutionCode(event.target.value)} value={institutionCode}>{accessibleInstitutions.map((institution) => <option key={institution.code} value={institution.code}>{institution.name}</option>)}</select></label></div><button className="primary-button primary-button--compact" onClick={openNewEmployee} type="button">新增人员</button></div>
              <table className="management-table">
                <thead><tr><th>工号</th><th>姓名</th><th>机构</th><th>人员状态</th><th>岗位角色</th><th>操作</th></tr></thead>
                <tbody>{employees.map((operator) => <tr key={operator.id}><td>{operator.id}</td><td>{operator.profile?.displayName ?? '资料待完善'}</td><td>{operator.profile?.institutionName ?? '—'}</td><td>{personnelStatusLabel(operator)}</td><td>{roleNamesForOperator(state, operator.id).join('、') || '未分配'}</td><td><div className="management-row-actions"><button disabled={!operator.profile} onClick={() => operator.profile && setEditor({ mode: 'edit', operator, profile: structuredClone(operator.profile), reason: '' })} type="button">修改</button><button onClick={() => setEditor({ mode: 'role', operator, roleId: '', reason: '' })} type="button">权限</button><button disabled={operator.id === state.operator.id || operator.accountStatus === 'disabled'} onClick={() => setEditor({ mode: 'deactivate', operator, reason: '' })} type="button">删除</button></div></td></tr>)}</tbody>
              </table>
              {employees.length === 0 ? <p className="management-empty">当前机构没有人员记录。</p> : null}
            </section>
          </div>
        ) : section === 'roles' ? (
          <section aria-label="角色管理" className="management-panel management-table-wrap">
            <div className="management-toolbar"><p>角色功能树由角色能力清单投影；当前演练版本保留现行角色，不允许普通网点直接删除。</p></div>
            <table className="management-table"><thead><tr><th>角色名称</th><th>所属系统</th><th>角色层级</th><th>类型</th><th>功能权限</th><th>状态</th></tr></thead><tbody>{state.roles.map((role) => <tr key={role.id}><td>{role.name}</td><td>{role.system === 'production' ? '生产系统' : role.system === 'management' ? '管理系统' : 'APP 系统'}</td><td>{role.level}</td><td>{role.custom ? '自定义角色' : '预置角色'}</td><td>{role.permissions.length} 项</td><td>{role.status === 'active' ? '启用' : '停用'}</td></tr>)}</tbody></table>
          </section>
        ) : (
          <section aria-label="封发关系管理" className="management-panel management-table-wrap">
            <div className="management-toolbar"><p>关系由上级基础管理人员维护，普通网点只能刷新并使用；保存后立即进入封发匹配。</p><button className="secondary-button" onClick={() => void refreshDispatchRelations()} type="button">刷新</button></div>
            <h2>待维护关系</h2>
            <table className="management-table"><thead><tr><th>适用机构</th><th>业务产品</th><th>寄达区域</th><th>批量标志</th><th>待封发邮件</th><th>操作</th></tr></thead><tbody>{missingRelations.map((item) => { const targetInstitutionCode = serviceOperatorInstitutionCode(item.operator); return <tr key={dispatchRelationOverrideKey(item.product.id, item.destinationZone, item.bulk, targetInstitutionCode)}><td>{relationInstitutionLabel(targetInstitutionCode)}</td><td>{item.product.label}<small>{item.product.searchCode}</small></td><td>{destinationZoneLabel(item.destinationZone)}</td><td>{item.bulk ? '大宗' : '散件'}</td><td>{item.itemNumber}</td><td><button className="primary-button primary-button--compact" onClick={() => openRelationEditor(item)} type="button">维护</button></td></tr> })}{serviceWorkspace && missingRelations.length === 0 ? <tr><td colSpan={6}>当前没有缺失的封发关系。</td></tr> : null}{!serviceWorkspace ? <tr><td colSpan={6}>正在读取封发关系…</td></tr> : null}</tbody></table>
            <h2>已维护关系</h2>
            <table className="management-table"><thead><tr><th>适用机构</th><th>业务产品</th><th>寄达区域</th><th>批量标志</th><th>清单种类</th><th>接收局</th><th>邮路</th><th>维护人员 / 时间</th></tr></thead><tbody>{maintainedRelations.map((relation) => <tr key={relation.key}><td>{relationInstitutionLabel(relation.institutionCode)}</td><td>{relation.productLabel}<small>{relation.productSearchCode}</small></td><td>{destinationZoneLabel(relation.destinationZone)}</td><td>{relation.bulk ? '大宗' : '散件'}</td><td>{relation.manifestTypeName}<small>{relation.manifestTypeCode}</small></td><td>{relation.receivingOfficeName}<small>{relation.receivingOfficeCode}</small></td><td>{relation.routeCode}</td><td>{relation.updatedBy.displayName}<small>{relation.updatedAt.replace('T', ' ').slice(0, 19)}</small></td></tr>)}{serviceWorkspace && maintainedRelations.length === 0 ? <tr><td colSpan={8}>尚无人工维护记录；系统内置关系仍按产品规则匹配。</td></tr> : null}</tbody></table>
          </section>
        )}
      </section>

      {editor ? (
        <Modal eyebrow="人员管理" title={editor.mode === 'new' ? '新增人员申请' : editor.mode === 'edit' ? '修改人员信息申请' : editor.mode === 'role' ? '岗位权限申请' : '删除人员申请'} wide={editor.mode === 'new' || editor.mode === 'edit'}>
          <div className="modal-form management-editor">
            {editor.mode === 'new' ? <div className="management-form-grid"><label><span>员工工号</span><input aria-label="新增员工工号" onChange={(event) => setEditor({ ...editor, operatorId: event.target.value })} value={editor.operatorId} /></label><label><span>人员姓名</span><input aria-label="新增人员姓名" onChange={(event) => setEditor({ ...editor, profile: { ...editor.profile, displayName: event.target.value } })} value={editor.profile.displayName} /></label><label><span>手机号码</span><input aria-label="新增人员手机号码" onChange={(event) => setEditor({ ...editor, mobile: event.target.value })} value={editor.mobile} /></label><label><span>人员身份证</span><input aria-label="新增人员身份证" onChange={(event) => setEditor({ ...editor, profile: { ...editor.profile, identityCode: event.target.value } })} value={editor.profile.identityCode} /></label><label><span>性别</span><select aria-label="新增人员性别" onChange={(event) => setEditor({ ...editor, profile: { ...editor.profile, gender: event.target.value } })} value={editor.profile.gender}><option value="female">女</option><option value="male">男</option><option value="unspecified">未说明</option></select></label><label><span>人员类型</span><select aria-label="新增人员类型" onChange={(event) => setEditor({ ...editor, profile: { ...editor.profile, personnelType: event.target.value as PersonnelType } })} value={editor.profile.personnelType}><option value="contract-a">合同工 A 类</option><option value="contract-b">合同工 B 类</option><option value="labor-employment">劳务用工</option><option value="labor-contracting">劳务承揽</option><option value="part-time">非全日制用工</option><option value="business-outsourcing">业务外包</option><option value="commissioned-services">委托办</option></select></label><label><span>所属机构</span><input readOnly value={`${editor.profile.institutionName} ${editor.profile.institutionCode}`} /></label></div> : null}
            {editor.mode === 'edit' ? <div className="management-form-grid"><label><span>工号</span><input readOnly value={editor.operator.id} /></label><label><span>人员姓名</span><input aria-label="修改人员姓名" onChange={(event) => setEditor({ ...editor, profile: { ...editor.profile, displayName: event.target.value } })} value={editor.profile.displayName} /></label><label><span>手机号码</span><input aria-label="修改人员手机号码" onChange={(event) => setEditor({ ...editor, profile: { ...editor.profile, phone: event.target.value } })} value={editor.profile.phone} /></label><label><span>人员状态</span><select aria-label="修改人员状态" onChange={(event) => setEditor({ ...editor, profile: { ...editor.profile, personnelStatus: event.target.value } })} value={editor.profile.personnelStatus}><option value="active">在岗</option><option value="seconded">借调</option><option value="leave">离岗</option></select></label><label><span>人员类型</span><select aria-label="修改人员类型" onChange={(event) => setEditor({ ...editor, profile: { ...editor.profile, personnelType: event.target.value as PersonnelType } })} value={editor.profile.personnelType}><option value="contract-a">合同工 A 类</option><option value="contract-b">合同工 B 类</option><option value="labor-employment">劳务用工</option><option value="labor-contracting">劳务承揽</option><option value="part-time">非全日制用工</option><option value="business-outsourcing">业务外包</option><option value="commissioned-services">委托办</option></select></label><label><span>工作岗位</span><select aria-label="修改工作岗位" onChange={(event) => setEditor({ ...editor, profile: { ...editor.profile, workplaceRole: event.target.value } })} value={editor.profile.workplaceRole}><option value="counter-service">营业受理</option><option value="customer-service">客户服务</option><option value="operations">运营管理</option></select></label><label><span>岗位类别</span><select aria-label="修改岗位类别" onChange={(event) => setEditor({ ...editor, profile: { ...editor.profile, jobCategory: event.target.value } })} value={editor.profile.jobCategory}><option value="service">营业服务</option><option value="management">经营管理</option><option value="support">业务支撑</option></select></label></div> : null}
            {editor.mode === 'role' ? <><p>申请人员：{editor.operator.profile?.displayName}（{editor.operator.id}）</p><label><span>专项权限</span><select aria-label="人员申请专项权限" onChange={(event) => setEditor({ ...editor, roleId: event.target.value })} value={editor.roleId}><option value="">请选择</option>{state.roles.filter((role) => REQUESTABLE_ROLE_IDS.includes(role.id as typeof REQUESTABLE_ROLE_IDS[number]) && role.status === 'active' && !state.roleAssignments.some((assignment) => assignment.operatorId === editor.operator.id && assignment.roleId === role.id && assignment.status === 'active')).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label></> : null}
            {editor.mode === 'deactivate' ? <p>删除申请批准后，{editor.operator.profile?.displayName}（{editor.operator.id}）将被停用，但历史业务、考勤和审批记录会保留。</p> : null}
            <label><span>申请原因</span><textarea aria-label="人员申请原因" onChange={(event) => setEditor({ ...editor, reason: event.target.value })} rows={3} value={editor.reason} /></label>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" onClick={() => { setEditor(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" onClick={() => void submitEditor()} type="button">提交申请</button></div>
          </div>
        </Modal>
      ) : null}

      {relationDraft ? (
        <Modal description="产品和寄达区域由待封发邮件带入；清单、接收局、邮路和封发标志必须由当前登录的上级经办人员人工核对。" eyebrow="基础管理" title="维护封发关系" wide>
          <div className="modal-form mail-handover__modal-form">
            <dl className="status-list"><div><dt>适用机构</dt><dd>{relationInstitutionLabel(serviceOperatorInstitutionCode(relationDraft.item.operator))}</dd></div><div><dt>业务产品</dt><dd>{relationDraft.item.product.label}（{relationDraft.item.product.searchCode}）</dd></div><div><dt>示例邮件</dt><dd>{relationDraft.item.itemNumber}</dd></div><div><dt>寄达区域</dt><dd>{destinationZoneLabel(relationDraft.item.destinationZone)}</dd></div><div><dt>批量标志</dt><dd>{relationDraft.item.bulk ? '大宗' : '散件'}</dd></div></dl>
            <label><span>清单种类</span><select aria-label="关系维护清单种类" onChange={(event) => { setRelationDraft({ ...relationDraft, manifestTypeCode: event.target.value }); setError('') }} value={relationDraft.manifestTypeCode}><option value="">请选择</option>{DISPATCH_RELATION_MANIFEST_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.name}（{option.code}）</option>)}</select></label>
            <label><span>匹配邮路与接收局</span><select aria-label="关系维护邮路" onChange={(event) => { setRelationDraft({ ...relationDraft, routeCode: event.target.value }); setError('') }} value={relationDraft.routeCode}>{SIMULATED_POST_ROUTES.map((route) => { const receiver = SIMULATED_DISPATCH_RECEIVERS.find((candidate) => route.receivingOfficeCodes.includes(candidate.code)); return <option key={route.code} value={route.code}>{route.name}（{route.code}） / {receiver?.name ?? '接收局未配置'}</option> })}</select></label>
            <label><span>总包接收局</span><input readOnly value={relationReceiver ? `${relationReceiver.name}（${relationReceiver.code}）` : ''} /></label>
            <fieldset><legend>封发标志</legend><label><input checked={relationDraft.directSeal} onChange={(event) => setRelationDraft({ ...relationDraft, directSeal: event.target.checked })} type="checkbox" />直封</label><label><input checked={relationDraft.consolidation} onChange={(event) => setRelationDraft({ ...relationDraft, consolidation: event.target.checked })} type="checkbox" />汇封</label><label><input checked={relationDraft.localTransfer} onChange={(event) => setRelationDraft({ ...relationDraft, localTransfer: event.target.checked })} type="checkbox" />本转</label></fieldset>
            <label><input checked={relationDraft.acknowledged} onChange={(event) => { setRelationDraft({ ...relationDraft, acknowledged: event.target.checked }); setError('') }} type="checkbox" /><span>当前登录的上级经办人员已人工核对清单种类、总包接收局、邮路和封发标志。</span></label>
            {error ? <p className="customer-form-error" role="alert">{error}</p> : null}
            <div className="modal-actions"><button className="secondary-button" disabled={relationBusy} onClick={() => { setRelationDraft(null); setError('') }} type="button">取消</button><button className="primary-button primary-button--compact" disabled={relationBusy} onClick={() => void saveDispatchRelation()} type="button">保存封发关系</button></div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
