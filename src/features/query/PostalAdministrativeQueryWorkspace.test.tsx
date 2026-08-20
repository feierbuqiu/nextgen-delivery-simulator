import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PostalAdministrativeQueryWorkspace } from './PostalAdministrativeQueryWorkspace'

describe('PostalAdministrativeQueryWorkspace', () => {
  it('按 PDF 展示 GIS 入口、行政区划入口和完整结果列', async () => {
    const user = userEvent.setup()
    render(<PostalAdministrativeQueryWorkspace onBack={vi.fn()} />)

    const input = screen.getByRole('textbox', { name: '邮件详细地址信息' })
    expect(input).toHaveAttribute(
      'placeholder',
      '请输入地址信息，按回车换行，一次最多支持100条查询',
    )
    await user.type(input, '瀚原省栖沄市景麓区新程路 22 号')
    await user.click(screen.getByRole('button', { name: '查询(GIS)' }))

    const results = screen.getByRole('region', { name: '邮编行政区划查询结果' })
    expect(within(results).getByRole('columnheader', { name: '行政区划' })).toBeInTheDocument()
    expect(within(results).getByRole('columnheader', { name: '邮政编码' })).toBeInTheDocument()
    expect(within(results).getByRole('cell', { name: '990022000000' })).toBeInTheDocument()
    expect(within(results).getByRole('cell', { name: '瀚原省栖沄市景麓区' })).toBeInTheDocument()
    expect(within(results).getByRole('cell', { name: '110022' })).toBeInTheDocument()
  })

  it('支持多行行政区划匹配并显示未匹配行', async () => {
    const user = userEvent.setup()
    render(<PostalAdministrativeQueryWorkspace onBack={vi.fn()} />)

    await user.type(
      screen.getByRole('textbox', { name: '邮件详细地址信息' }),
      '澜京市栖台区云杉路 11 号{enter}不存在的地址',
    )
    await user.click(screen.getByRole('button', { name: '查询(行政区划匹配)' }))

    const results = screen.getByRole('region', { name: '邮编行政区划查询结果' })
    expect(within(results).getAllByRole('row')).toHaveLength(3)
    expect(within(results).getByRole('cell', { name: '查询成功' })).toBeInTheDocument()
    expect(within(results).getByRole('cell', { name: '查询失败' })).toBeInTheDocument()
    expect(within(results).getByRole('cell', { name: '不存在的地址' })).toBeInTheDocument()
  })

  it('限制一次最多查询一百条', async () => {
    const user = userEvent.setup()
    render(<PostalAdministrativeQueryWorkspace onBack={vi.fn()} />)

    fireEvent.change(screen.getByRole('textbox', { name: '邮件详细地址信息' }), {
      target: { value: Array.from({ length: 101 }, (_, index) => `地址${index}`).join('\n') },
    })
    await user.click(screen.getByRole('button', { name: '查询(GIS)' }))
    expect(screen.getByRole('alert')).toHaveTextContent('一次最多支持 100 条地址查询。')
  })
})
