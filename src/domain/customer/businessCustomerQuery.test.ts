import { describe, expect, it } from 'vitest'

import { createCustomerSeedState } from './seed'
import {
  maskBusinessCustomerPhone,
  queryBusinessCustomer,
} from './businessCustomerQuery'

describe('营业客户查询', () => {
  it('按完整手机号优先返回协议客户主记录并投影生日、年龄和地域', () => {
    const result = queryBusinessCustomer(
      createCustomerSeedState(),
      { phone: '10000000016', identityValue: '' },
      '2026-08-19T12:00:00+08:00',
    )

    expect(result).toMatchObject({
      id: 'agreement:91000000000001',
      source: 'agreement-account',
      name: '林澄',
      gender: 'male',
      age: 31,
      birthDate: '1995-07-23',
      phone: '10000000016',
      identityType: 'primary',
      identityValue: '990101199507230035',
    })
    expect(result?.region).toContain('瀚原省')
  })

  it('按完整证件号查询且两个条件同时填写时执行同一客户匹配', () => {
    const state = createCustomerSeedState()
    expect(queryBusinessCustomer(state, {
      phone: '',
      identityValue: '990101199507230035',
    })?.id).toBe('agreement:91000000000001')
    expect(queryBusinessCustomer(state, {
      phone: '10000000020',
      identityValue: '990101199507230035',
    })).toBeNull()
  })

  it('没有协议主记录时只允许手机号回退到已保存的寄件历史', () => {
    const state = createCustomerSeedState()
    state.agreementAccounts = []

    expect(queryBusinessCustomer(state, {
      phone: '10000000020',
      identityValue: '',
    })).toMatchObject({
      id: 'history:sender-003',
      source: 'sender-history',
      name: '周安',
      identityValue: '',
    })
    expect(queryBusinessCustomer(state, {
      phone: '',
      identityValue: '990101199507230035',
    })).toBeNull()
  })

  it('拒绝空查询、非完整手机号和超长证件号', () => {
    const state = createCustomerSeedState()
    expect(() => queryBusinessCustomer(state, {
      phone: '',
      identityValue: '',
    })).toThrow('请输入手机号或证件号')
    expect(() => queryBusinessCustomer(state, {
      phone: '1880000',
      identityValue: '',
    })).toThrow('手机号须为 11 位数字')
    expect(() => queryBusinessCustomer(state, {
      phone: '',
      identityValue: 'A'.repeat(21),
    })).toThrow('证件号不得超过 20 个字符')
  })

  it('结果投影只暴露脱敏手机号', () => {
    expect(maskBusinessCustomerPhone('10000000016')).toBe('100****0016')
  })
})
