import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { hashSecret, secretMatches } from '../../domain/access/policy'
import {
  DEMO_BOUND_MOBILE,
  DEMO_MANAGEMENT_OPERATOR_ID,
  DEMO_MANAGEMENT_SECRET,
  DEMO_TEMPORARY_SECRET,
} from '../../domain/access/seed'
import {
  ACCESS_MAX_SECRET_ATTEMPTS,
  DEMO_ACCESS_SUPERVISOR_ID,
  DEMO_ACCESS_SUPERVISOR_SECRET,
  DEMO_RECOVERY_GRAPHICAL_CODE,
  DEMO_RECOVERY_SMS_CODE,
  registerSecretFailure,
} from '../../domain/access/security'
import { MemoryAccessRepository } from '../../infrastructure/memory/MemoryAccessRepository'
import { MemoryCustomerRepository } from '../../infrastructure/memory/MemoryCustomerRepository'
import { MemoryServiceRepository } from '../../infrastructure/memory/MemoryServiceRepository'
import { AccessExperience } from './AccessExperience'

async function createRepositoryWithFailures(count: number): Promise<MemoryAccessRepository> {
  const repository = await MemoryAccessRepository.create()
  let state = await repository.load()
  for (let attempt = 1; attempt <= count; attempt += 1) {
    state = registerSecretFailure(
      state,
      `2026-08-10T07:00:${String(attempt).padStart(2, '0')}.000Z`,
    ).state
  }
  await repository.save(state)
  return repository
}

describe('AccessExperience', () => {
  afterEach(() => vi.useRealTimers())
  it('offers a retry instead of remaining on the loading screen when local data fails', async () => {
    const repository = await MemoryAccessRepository.create()
    vi.spyOn(repository, 'load').mockRejectedValueOnce(new Error('simulated IndexedDB failure'))
    const user = userEvent.setup()
    render(
      <AccessExperience
        customerRepository={MemoryCustomerRepository.create()}
        repository={repository}
        serviceRepository={MemoryServiceRepository.create()}
      />,
    )

    expect(await screen.findByRole('heading', { name: '本机数据加载异常' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('本机演示数据未能读取')

    await user.click(screen.getByRole('button', { name: '重试加载' }))

    expect(await screen.findByRole('heading', { name: '次世代寄递业务模拟器' })).toBeInTheDocument()
  })

  it('keeps every public-facing identity fictional', async () => {
    const repository = await MemoryAccessRepository.create()
    const customerRepository = MemoryCustomerRepository.create()
    const serviceRepository = MemoryServiceRepository.create()
    render(
      <AccessExperience
        customerRepository={customerRepository}
        repository={repository}
        serviceRepository={serviceRepository}
      />,
    )

    expect(await screen.findByText('寄递演练')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '次世代寄递业务模拟器' })).toBeInTheDocument()
    expect(screen.getByText('LOCAL DELIVERY LAB')).toBeInTheDocument()
    expect(screen.getByText('V0.0.10086')).toBeInTheDocument()
    expect(screen.getByText('次世代寄递业务模拟器 2026 · 非官方离线工具')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '扫码登录示意二维码' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByText('账户登录')).not.toBeInTheDocument()
    expect(screen.queryByText('本地码登录')).not.toBeInTheDocument()
    expect(document.querySelectorAll('.input-icon svg')).toHaveLength(3)
    expect(Array.from(document.querySelectorAll('.input-icon')).map((item) => item.textContent)).toEqual([
      '',
      '',
      '',
    ])
  })

  it('uses an icon-only visibility control and the documented seat placeholder', async () => {
    const repository = await MemoryAccessRepository.create()
    const user = userEvent.setup()
    render(
      <AccessExperience
        customerRepository={MemoryCustomerRepository.create()}
        repository={repository}
        serviceRepository={MemoryServiceRepository.create()}
      />,
    )

    const secretInput = await screen.findByPlaceholderText('请输入密码')
    const visibilityButton = screen.getByRole('button', { name: '显示密码' })
    expect(DEMO_TEMPORARY_SECRET).toBe('6yhn&UJM8ik,')
    expect(secretInput).toHaveValue('6yhn&UJM8ik,')
    expect(visibilityButton).toHaveTextContent('')
    expect(visibilityButton.querySelector('svg')).not.toBeNull()
    expect(secretInput).toHaveAttribute('type', 'password')
    expect(screen.getByPlaceholderText('请输入坐席号')).toHaveValue('1')

    await user.click(visibilityButton)
    expect(secretInput).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: '隐藏密码' })).toBeInTheDocument()
  })

  it('blocks an invalid secret without discarding other input', async () => {
    const repository = await MemoryAccessRepository.create()
    const customerRepository = MemoryCustomerRepository.create()
    const serviceRepository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(
      <AccessExperience
        customerRepository={customerRepository}
        repository={repository}
        serviceRepository={serviceRepository}
      />,
    )

    const secretInput = await screen.findByPlaceholderText('请输入密码')
    await user.clear(secretInput)
    await user.type(secretInput, 'Wrong!Access26')
    await user.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('账户或密码不正确')
    expect(screen.getByPlaceholderText('请输入账户或演示手机号')).toHaveValue(
      '80000001',
    )
    expect(screen.getByPlaceholderText('请输入坐席号')).toHaveValue('1')
  })

  it('recovers the secret through bound-mobile identity verification and requires a new login', async () => {
    const repository = await MemoryAccessRepository.create()
    const user = userEvent.setup()
    render(
      <AccessExperience
        customerRepository={MemoryCustomerRepository.create()}
        repository={repository}
        serviceRepository={MemoryServiceRepository.create()}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '忘记密码' }))
    const recoveryDialog = screen.getByRole('dialog', { name: '忘记密码' })
    expect(within(recoveryDialog).getByText('身份认证')).toBeInTheDocument()
    await user.type(within(recoveryDialog).getByPlaceholderText('请输入手机号'), DEMO_BOUND_MOBILE)
    await user.type(
      within(recoveryDialog).getByPlaceholderText('请输入图形验证码'),
      DEMO_RECOVERY_GRAPHICAL_CODE,
    )
    await user.click(within(recoveryDialog).getByRole('button', { name: '获取验证码' }))
    expect(within(recoveryDialog).getByRole('status')).toHaveTextContent(DEMO_RECOVERY_SMS_CODE)
    await user.type(
      within(recoveryDialog).getByPlaceholderText('请输入短信验证码'),
      DEMO_RECOVERY_SMS_CODE,
    )
    await user.click(within(recoveryDialog).getByRole('button', { name: '找回密码' }))

    expect(within(recoveryDialog).getByText('新密码设置')).toBeInTheDocument()
    await user.type(within(recoveryDialog).getByLabelText('新密码'), 'Recovered!2608')
    await user.click(within(recoveryDialog).getByRole('button', { name: '确认提交' }))

    expect(await screen.findByText('密码重置成功，请使用新密码重新登录。')).toBeInTheDocument()
    const recovered = await repository.load()
    await expect(secretMatches('Recovered!2608', recovered.operator.secretHash)).resolves.toBe(true)
    expect(recovered.security.events.at(-1)).toMatchObject({
      type: 'secret-recovered',
      method: 'bound-mobile',
    })

    await user.type(screen.getByPlaceholderText('请输入密码'), 'Recovered!2608')
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('dialog', { name: '修改人员信息' })).toBeInTheDocument()
  })

  it('warns from the sixth failure, locks on the tenth, and requires supervisor authorization', async () => {
    const repository = await createRepositoryWithFailures(5)
    const user = userEvent.setup()
    render(
      <AccessExperience
        customerRepository={MemoryCustomerRepository.create()}
        repository={repository}
        serviceRepository={MemoryServiceRepository.create()}
      />,
    )

    const secretInput = await screen.findByPlaceholderText('请输入密码')
    await user.clear(secretInput)
    await user.type(secretInput, 'Wrong!Access26')
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('您还有4次机会')
    for (let attempt = 7; attempt <= ACCESS_MAX_SECRET_ATTEMPTS; attempt += 1) {
      await user.click(screen.getByRole('button', { name: '登录' }))
    }
    expect(screen.getByRole('alert')).toHaveTextContent('您的账户已经被锁定，请联系主管')

    await user.clear(secretInput)
    await user.type(secretInput, DEMO_TEMPORARY_SECRET)
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(screen.getByRole('alert')).toHaveTextContent('您的账户已经被锁定，请联系主管')

    await user.click(screen.getByRole('button', { name: '解锁授权' }))
    const unlockDialog = screen.getByRole('dialog', { name: '解锁授权' })
    expect(within(unlockDialog).getByLabelText('主管工号')).toHaveValue('')
    expect(within(unlockDialog).getByLabelText('主管密码')).toHaveValue('')
    await user.type(within(unlockDialog).getByLabelText('主管工号'), DEMO_ACCESS_SUPERVISOR_ID)
    await user.type(within(unlockDialog).getByLabelText('主管密码'), 'Wrong!Supervisor26')
    await user.click(within(unlockDialog).getByRole('button', { name: '确认授权' }))
    expect(within(unlockDialog).getByRole('alert')).toHaveTextContent('主管授权失败')
    await user.clear(within(unlockDialog).getByLabelText('主管密码'))
    await user.type(within(unlockDialog).getByLabelText('主管密码'), DEMO_ACCESS_SUPERVISOR_SECRET)
    await user.click(within(unlockDialog).getByRole('button', { name: '确认授权' }))

    expect(await screen.findByText('主管授权成功，账户已解锁，请重新登录。')).toBeInTheDocument()
    const unlocked = await repository.load()
    expect(unlocked.security).toMatchObject({ failedSecretAttempts: 0, lockedAt: null })
    expect(unlocked.security.events.at(-1)?.method).toBe('supervisor-credentials')
  })

  it('does not offer simulated QR or remote supervisor approval', async () => {
    const repository = await createRepositoryWithFailures(ACCESS_MAX_SECRET_ATTEMPTS)
    const user = userEvent.setup()
    render(
      <AccessExperience
        customerRepository={MemoryCustomerRepository.create()}
        repository={repository}
        serviceRepository={MemoryServiceRepository.create()}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '解锁授权' }))
    const unlockDialog = screen.getByRole('dialog', { name: '解锁授权' })
    expect(within(unlockDialog).queryByRole('button', { name: /扫码授权/ })).not.toBeInTheDocument()
    expect(within(unlockDialog).queryByRole('button', { name: /远程授权/ })).not.toBeInTheDocument()
    expect(within(unlockDialog).getByText('仅支持主管本人在当前终端完成人工核准。')).toBeInTheDocument()
    expect((await repository.load()).security.lockedAt).not.toBeNull()
  })

  it('rejects an earlier password even when it is no longer the current password', async () => {
    const repository = await MemoryAccessRepository.create()
    const seeded = await repository.load()
    const currentSecret = 'Fresh!Access26'
    const currentSecretHash = await hashSecret(currentSecret)
    await repository.save({
      ...seeded,
      operator: {
        ...seeded.operator,
        profileCompleted: true,
        requiresSecretChange: true,
        secretHash: currentSecretHash,
        secretHistoryHashes: [seeded.operator.secretHash, currentSecretHash],
      },
    })
    const user = userEvent.setup()
    render(
      <AccessExperience
        customerRepository={MemoryCustomerRepository.create()}
        repository={repository}
        serviceRepository={MemoryServiceRepository.create()}
      />,
    )

    const loginSecret = await screen.findByPlaceholderText('请输入密码')
    await user.clear(loginSecret)
    await user.type(loginSecret, currentSecret)
    await user.click(screen.getByRole('button', { name: '登录' }))

    const secretDialog = await screen.findByRole('dialog', { name: '人员密码修改' })
    await user.type(within(secretDialog).getByLabelText('原密码'), currentSecret)
    await user.type(within(secretDialog).getByLabelText('新密码'), DEMO_TEMPORARY_SECRET)
    await user.type(within(secretDialog).getByLabelText('确认新密码'), DEMO_TEMPORARY_SECRET)
    await user.click(within(secretDialog).getByRole('button', { name: '确定' }))

    expect(await within(secretDialog).findByRole('alert')).toHaveTextContent(
      '新密码不能与任何旧密码重复',
    )
  })

  it('completes the first-use journey and enters the persisted shell', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-08-12T01:30:00.000Z'))
    const repository = await MemoryAccessRepository.create()
    const customerRepository = MemoryCustomerRepository.create()
    const serviceRepository = MemoryServiceRepository.create()
    const user = userEvent.setup()
    render(
      <AccessExperience
        customerRepository={customerRepository}
        repository={repository}
        serviceRepository={serviceRepository}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '登录' }))
    const profileDialog = await screen.findByRole('dialog', {
      name: '修改人员信息',
    })
    const expectedProfileFields = [
      '人员姓名',
      '姓名简拼',
      '人员身份证',
      '性别',
      '人员状态',
      '人员类型',
      '出生年月日',
      '手机号码',
      '机构编码',
      '机构名称',
      '在岗日期',
      '人员工龄',
      '到岗日期',
      '离岗日期',
      '精神面貌',
      '工作岗位',
      '岗位类别',
      '直接主管',
      '文化程度',
      '职业资格',
      '替班权限',
      '岗位信息',
      '接收短信类型',
      '接收短信时间',
      '负责巡店网点',
      '业绩来源网点',
      '业绩评价',
    ]
    for (const field of expectedProfileFields) {
      expect(within(profileDialog).getByText(field, {
        exact: false,
        selector: 'label > span',
      })).toBeInTheDocument()
    }
    expect(within(profileDialog).queryByText('别名', { exact: true })).not.toBeInTheDocument()
    expect(within(profileDialog).getByLabelText('人员姓名')).toHaveValue('演示营业员')
    expect(within(profileDialog).getByLabelText('机构名称')).toHaveValue('景麓营业部')
    expect(within(profileDialog).getByLabelText('出生年月日')).toHaveValue('1990-01-01')
    expect(within(profileDialog).getByLabelText(/在岗日期/)).toHaveValue('2020-07-01')
    expect(within(profileDialog).getByLabelText(/到岗日期/)).toHaveValue('2020-07-01')
    expect(within(profileDialog).getByLabelText('离岗日期')).toHaveAttribute('placeholder', 'YYYY-MM-DD')
    expect(within(profileDialog).getByLabelText('人员工龄')).toHaveValue('6年1个月')
    expect(within(profileDialog).getByLabelText('人员工龄')).not.toHaveAttribute('type', 'number')

    const personnelType = within(profileDialog).getByLabelText(/人员类型/)
    expect(within(personnelType).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '合同工 A 类',
      '合同工 B 类',
      '劳务用工',
      '劳务承揽',
      '非全日制用工',
      '业务外包',
      '委托办',
    ])
    expect(within(within(profileDialog).getByLabelText(/职业资格/)).getByRole('option', { name: '无' }))
      .toBeInTheDocument()

    const identityCode = within(profileDialog).getByLabelText(/人员身份证/)
    await user.clear(identityCode)
    await user.type(identityCode, '990101199001010021')
    expect(within(profileDialog).getByLabelText(/性别/)).toHaveValue('female')
    await user.selectOptions(within(profileDialog).getByLabelText(/性别/), 'male')
    expect(within(profileDialog).getByLabelText(/性别/)).toHaveValue('male')

    await user.selectOptions(within(profileDialog).getByLabelText(/替班权限/), 'enabled')
    for (const reliefRole of [
      'APP 特殊处理',
      'APP 分发处理',
      'APP 业财缴款',
      '新容器管理',
      '营业渠道',
      'APP 日戳处理',
    ]) {
      expect(within(profileDialog).getByRole('checkbox', { name: reliefRole })).toBeInTheDocument()
    }
    await user.click(within(profileDialog).getByRole('checkbox', { name: 'APP 特殊处理' }))
    await user.click(within(profileDialog).getByRole('checkbox', { name: '营业渠道' }))
    expect(within(profileDialog).getByLabelText(/^\*?\s*岗位信息$/)).toHaveValue('counter-operator')
    expect(within(profileDialog).getByRole('button', { name: /兼职岗位信息维护/ })).toBeDisabled()
    expect(within(profileDialog).getByRole('button', { name: /人员标签采集/ })).toBeDisabled()
    await user.click(within(profileDialog).getByRole('button', { name: '确定' }))

    const secretDialog = await screen.findByRole('dialog', {
      name: '人员密码修改',
    })
    await user.type(
      within(secretDialog).getByLabelText('原密码'),
      DEMO_TEMPORARY_SECRET,
    )
    await user.type(
      within(secretDialog).getByLabelText('新密码'),
      DEMO_TEMPORARY_SECRET,
    )
    await user.type(
      within(secretDialog).getByLabelText('确认新密码'),
      DEMO_TEMPORARY_SECRET,
    )
    await user.click(within(secretDialog).getByRole('button', { name: '确定' }))
    expect(await within(secretDialog).findByRole('alert')).toHaveTextContent(
      '新密码不能与任何旧密码重复',
    )

    await user.clear(within(secretDialog).getByLabelText('新密码'))
    await user.type(within(secretDialog).getByLabelText('新密码'), 'Fresh!Access26')
    await user.clear(within(secretDialog).getByLabelText('确认新密码'))
    await user.type(within(secretDialog).getByLabelText('确认新密码'), 'Fresh!Access26')
    await user.click(within(secretDialog).getByRole('button', { name: '确定' }))

    expect(await screen.findByText('密码修改成功，请使用新密码重新登录。')).toBeInTheDocument()
    const loginSecret = screen.getByPlaceholderText('请输入密码')
    await user.type(loginSecret, 'Fresh!Access26')
    await user.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByRole('region', { name: '主页信息' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /通知公告/ })).toBeInTheDocument()
    expect(screen.getByText('本地寄递演练')).toBeInTheDocument()
    const workspaceTabs = screen.getByRole('navigation', { name: '已打开工作页' })
    expect(within(workspaceTabs).getByRole('button', { name: '主页' }))
      .toHaveAttribute('aria-current', 'page')
    expect(within(workspaceTabs).queryByRole('button', { name: '关闭主页选项卡' }))
      .not.toBeInTheDocument()
    expect(document.querySelector('.shell-brand time')).toHaveTextContent(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    )
    const operatorMenuTrigger = screen.getByRole('button', {
      name: /人员信息：景麓营业部 99901001.*欢迎 演示营业员/,
    })
    expect(within(operatorMenuTrigger).getByText('景麓营业部 99901001')).toBeInTheDocument()
    expect(within(operatorMenuTrigger).getByText('欢迎 演示营业员')).toBeInTheDocument()
    expect(within(operatorMenuTrigger).getByText('台席：01')).toBeInTheDocument()
    expect(within(operatorMenuTrigger).getByText('工号：80000001')).toBeInTheDocument()
    await user.click(operatorMenuTrigger)
    expect(screen.getAllByText('台席：01')).toHaveLength(1)
    expect(screen.getAllByText('工号：80000001')).toHaveLength(1)
    expect(screen.getByText('台席：01 · 工号：80000001')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '导出演示数据' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '导入演示数据' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '个人设置' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '我的岗位与权限' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '我的申请' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '签到签退' })).toBeInTheDocument()
    expect(screen.getByLabelText('选择演示数据备份文件')).toHaveAttribute('accept', 'application/json,.json')
    await user.click(operatorMenuTrigger)

    const globalNavigation = screen.getByRole('navigation', { name: '全局业务导航' })
    expect(within(globalNavigation).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '工作台',
      '收藏夹',
      '营业渠道',
      '报刊业务未授权',
      '账务处理',
      '集邮服务未授权',
    ])
    await user.click(within(globalNavigation).getByRole('button', {
      name: '报刊业务（未授权，点击申请）',
    }))
    const permissionDialog = screen.getByRole('dialog', { name: '个人设置' })
    expect(within(permissionDialog).getByRole('region', { name: '可见功能目录' }))
      .toHaveTextContent('报刊业务')
    expect(within(permissionDialog).getByRole('combobox', { name: '申请专项权限' }))
      .toHaveValue('periodicals-operator')
    await user.click(within(permissionDialog).getByRole('button', { name: '关闭' }))
    expect(screen.getByRole('button', { name: '展开更多栏目' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )

    const attendance = screen.getByRole('group', { name: '机构与员工签到时间' })
    const launcher = screen.getByRole('button', { name: '展开更多栏目' })
    expect(Array.from(attendance.querySelectorAll('dt')).map((item) => item.textContent)).toEqual([
      '机构签到',
      '机构签退',
      '员工签到',
      '员工签退',
    ])
    expect(within(attendance).queryByRole('button')).not.toBeInTheDocument()
    expect(
      launcher.compareDocumentPosition(attendance) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const attendanceValues = Array.from(attendance.querySelectorAll('dd'))
      .map((item) => item.textContent)
    expect(attendanceValues.slice(2)).toEqual(['还未签到', '还未签退'])
    expect(attendanceValues[0]).toMatch(/^(还未签到|\d{2}:\d{2}:\d{2})$/)

    const operationalNavigation = screen.getByRole('navigation', {
      name: '营业渠道功能菜单',
    })
    expect(operationalNavigation.querySelectorAll('.shell-menu-icon')).toHaveLength(11)
    expect(operationalNavigation.querySelectorAll('.shell-menu-icon:not(svg)')).toHaveLength(0)
    expect(operationalNavigation).not.toHaveTextContent('📮')
    const businessParent = within(operationalNavigation).getByRole('button', {
      name: '业务办理',
    })
    expect(within(operationalNavigation).getByRole('button', {
      name: '商函账单处理',
    })).toBeInTheDocument()
    expect(businessParent).toHaveAttribute('aria-expanded', 'true')
    const businessChildren = document.getElementById('shell-menu-business')
    expect(businessChildren).not.toBeNull()
    expect(within(businessChildren!).getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      '业务推荐',
      '综合受理',
      '大宗处理',
      '网点叠加业务补录',
      '商函邮件大宗处理',
      '公益邮件大宗处理',
      '查改处理',
      '退款待办查询',
      '回执寄回办理',
      '国际回信券兑付',
      '客户自助批量导入',
      '结算方式查改',
      '多渠道商品简易销售',
      '多渠道商品综合销售查改',
      '保险业务受理未授权',
    ])
    await user.click(businessParent)
    expect(businessParent).toHaveAttribute('aria-expanded', 'false')
    expect(within(operationalNavigation).queryByRole('button', { name: '综合受理' })).not.toBeInTheDocument()
    await user.click(businessParent)
    await user.click(within(operationalNavigation).getByRole('button', { name: '综合受理' }))
    const dutyGate = screen.getByRole('dialog', { name: '当前员工未处于有效签到状态' })
    await user.click(within(dutyGate).getByRole('button', { name: '前往签到签退' }))
    await user.click(await screen.findByRole('button', { name: '当前员工签到' }))
    const attendanceDialog = screen.getByRole('dialog', { name: '员工签到' })
    await user.type(within(attendanceDialog).getByLabelText('签到签退当前登录密码'), 'Fresh!Access26')
    await user.click(within(attendanceDialog).getByRole('checkbox'))
    await user.click(within(attendanceDialog).getByRole('button', { name: '确认办理' }))
    expect(await within(attendanceDialog).findByRole('alert')).toHaveTextContent('机构人工签到')
    await user.click(within(attendanceDialog).getByRole('button', { name: '取消' }))
    await user.click(within(workspaceTabs).getByRole('button', { name: '主页' }))
    expect(await screen.findByRole('region', { name: '主页信息' }))
      .toBeInTheDocument()

    await expect(repository.load()).resolves.toMatchObject({
      operator: {
        profileCompleted: true,
        requiresSecretChange: false,
        secretHistoryHashes: expect.arrayContaining([
          expect.stringMatching(/^[a-f0-9]{64}$/),
        ]),
        profile: {
          institutionName: '景麓营业部',
          institutionCode: '99901001',
          displayName: '演示营业员',
          personnelType: 'contract-a',
          jobInformation: 'counter-operator',
          reliefEligible: true,
          reliefRoleIds: ['app-special-processing', 'business-channel'],
          receiveSmsType: 'business-and-security',
          receiveSmsTime: '08:00-20:00',
          responsibleStoreOutlet: '景麓营业部',
          performanceSourceOutlet: '景麓营业部',
          performanceEvaluation: '良好',
        },
      },
      session: {
        workstationCode: '01',
      },
      attendanceRecords: [],
    })
  }, 20_000)

  it('limits a supervisor to attendance and accounting instead of operational or role administration work', async () => {
    const repository = await MemoryAccessRepository.create()
    const user = userEvent.setup()
    render(
      <AccessExperience
        customerRepository={MemoryCustomerRepository.create()}
        repository={repository}
        serviceRepository={MemoryServiceRepository.create()}
      />,
    )

    const identifier = await screen.findByPlaceholderText('请输入账户或演示手机号')
    const secret = screen.getByPlaceholderText('请输入密码')
    await user.clear(identifier)
    await user.type(identifier, DEMO_MANAGEMENT_OPERATOR_ID)
    await user.clear(secret)
    await user.type(secret, DEMO_MANAGEMENT_SECRET)
    await user.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByRole('region', { name: '主页信息' })).toBeInTheDocument()
    expect(screen.getByRole('button', {
      name: /人员信息：景麓营业部 99901001.*欢迎 演示主管/,
    })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '展开更多栏目' }))
    const applications = screen.getByRole('menu', { name: '更多栏目' })
    expect(within(applications).getByRole('menuitem', { name: '业务管理' })).toBeInTheDocument()
    expect(within(applications).getByRole('menuitem', { name: '基础管理未授权' })).toBeInTheDocument()
    await user.click(within(applications).getByRole('menuitem', { name: '业务管理' }))
    expect(await screen.findByRole('heading', { name: '业务管理' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '签到签退查询' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '人员审批' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '岗位角色审批' })).not.toBeInTheDocument()

    const saved = await repository.load()
    expect(saved.session).toMatchObject({ operatorId: DEMO_MANAGEMENT_OPERATOR_ID, workstationCode: '01' })
    expect(saved.attendanceRecords).toHaveLength(0)
  })

  it('requires relief roles only when relief permission is enabled', async () => {
    const repository = await MemoryAccessRepository.create()
    const user = userEvent.setup()
    render(
      <AccessExperience
        customerRepository={MemoryCustomerRepository.create()}
        repository={repository}
        serviceRepository={MemoryServiceRepository.create()}
      />,
    )

    await user.click(await screen.findByRole('button', { name: '登录' }))
    const profileDialog = await screen.findByRole('dialog', { name: '修改人员信息' })
    await user.selectOptions(within(profileDialog).getByLabelText(/替班权限/), 'enabled')
    await user.click(within(profileDialog).getByRole('button', { name: '确定' }))

    expect(within(profileDialog).getByRole('alert')).toHaveTextContent(
      '信息不完整，请先完善所有必填项。',
    )
    await user.click(within(profileDialog).getByRole('checkbox', { name: 'APP 日戳处理' }))
    await user.click(within(profileDialog).getByRole('button', { name: '确定' }))
    expect(await screen.findByRole('dialog', { name: '人员密码修改' })).toBeInTheDocument()
  })
})
