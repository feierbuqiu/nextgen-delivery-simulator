import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  ADMINISTRATIVE_POSTAL_RELATIONSHIPS,
  DIRECT_SEAL_RELATIONSHIPS,
  HIERARCHICAL_HUB_RELATIONSHIPS,
} from '../../domain/service/routingRelationshipQuery'
import {
  RoutingRelationshipWorkspace,
  type RoutingRelationshipSection,
} from './RoutingRelationshipWorkspace'

function renderWorkspace(section: RoutingRelationshipSection) {
  return render(<RoutingRelationshipWorkspace onBack={vi.fn()} section={section} />)
}

describe('RoutingRelationshipWorkspace', () => {
  it('queries effective postal routes and opens the station-order details', async () => {
    const user = userEvent.setup()
    renderWorkspace('post-route-comparison')

    const filters = screen.getByRole('region', { name: '邮路对照查询条件' })
    await user.click(within(filters).getByRole('button', { name: '查询' }))
    const results = screen.getByRole('region', { name: '邮路对照信息结果' })
    expect(within(results).getAllByRole('button', { name: '邮路站序详情' })).toHaveLength(3)
    expect(within(results).getByText('不分上下行')).toBeInTheDocument()

    await user.click(within(results).getAllByRole('button', { name: '邮路站序详情' })[0]!)
    const dialog = screen.getByRole('dialog', { name: '邮路站序详情' })
    expect(within(dialog).getByText('景麓营业部')).toBeInTheDocument()
    expect(within(dialog).getByText('大国邮运枢纽')).toBeInTheDocument()
  })

  it('filters the network-export relationship by mail kind and route', async () => {
    const user = userEvent.setup()
    renderWorkspace('network-export-relationship')

    const filters = screen.getByRole('region', { name: '网运出口关系查询条件' })
    await user.selectOptions(within(filters).getByLabelText('网运邮件种类'), '4')
    await user.selectOptions(within(filters).getByLabelText('网运本转标志'), 'undivided')
    await user.type(within(filters).getByLabelText('网运邮路'), '镜海埠')
    await user.click(within(filters).getByRole('button', { name: '查询' }))

    const results = screen.getByRole('region', { name: '网运出口关系信息结果' })
    expect(within(results).getByRole('cell', { name: '4 / 特快' })).toBeInTheDocument()
    expect(within(results).getByText('镜海埠互换邮路')).toBeInTheDocument()
    expect(within(results).getByRole('cell', { name: '本转不分' })).toBeInTheDocument()
  })

  it('runs the branch-export and bag-unloading tabs', async () => {
    const user = userEvent.setup()
    renderWorkspace('branch-export-relationship')

    const branchFilters = screen.getByRole('region', { name: '支局出口关系查询条件' })
    await user.selectOptions(within(branchFilters).getByLabelText('支局出口业务产品'), '300')
    await user.click(within(branchFilters).getByRole('button', { name: '查询' }))
    const branchResults = screen.getByRole('region', { name: '支局出口关系信息结果' })
    expect(within(branchResults).getByRole('cell', { name: '普通包裹' })).toBeInTheDocument()
    expect(within(branchResults).getByRole('cell', { name: '300' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '总包卸交站关系查询' }))
    const unloadingFilters = screen.getByRole('region', { name: '总包卸交站关系查询条件' })
    await user.selectOptions(within(unloadingFilters).getByLabelText('卸交站邮路代码'), 'SIM-A01')
    await user.click(within(unloadingFilters).getByRole('button', { name: '查询' }))
    const unloadingResults = screen.getByRole('region', { name: '总包卸交站关系信息结果' })
    expect(within(unloadingResults).getAllByRole('cell', { name: 'SIM-A01' }).length).toBeGreaterThan(0)
  })

  it('cascades direct-seal regions and loads international relations on tab entry', async () => {
    const user = userEvent.setup()
    const sample = DIRECT_SEAL_RELATIONSHIPS[0]!
    renderWorkspace('branch-export-relationship')

    await user.click(screen.getByRole('button', { name: '直封封发关系查询' }))
    const directFilters = screen.getByRole('region', { name: '直封封发关系查询条件' })
    await user.selectOptions(within(directFilters).getByLabelText('直封省份'), sample.provinceName)
    expect(within(directFilters).getByLabelText('直封省份')).toHaveValue(sample.provinceName)
    await user.selectOptions(within(directFilters).getByLabelText('直封地市'), sample.prefectureName)
    await user.selectOptions(within(directFilters).getByLabelText('直封区县'), sample.countyName)
    await user.click(within(directFilters).getByRole('button', { name: '查询' }))
    const directResults = screen.getByRole('region', { name: '直封封发关系信息结果' })
    expect(within(directResults).getByRole('cell', { name: sample.administrativeCode })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '国际普邮出口关系查询' }))
    const internationalResults = screen.getByRole('region', { name: '国际普邮出口关系信息结果' })
    expect(within(internationalResults).getByRole('cell', { name: 'AU' })).toBeInTheDocument()
    expect(within(internationalResults).getAllByRole('cell', { name: '镜海埠互换中心' })).toHaveLength(3)
  })

  it('validates and resolves administrative-postal and hierarchical-hub codes', async () => {
    const user = userEvent.setup()
    const administrative = ADMINISTRATIVE_POSTAL_RELATIONSHIPS[0]!
    const hierarchy = HIERARCHICAL_HUB_RELATIONSHIPS[0]!
    renderWorkspace('branch-export-relationship')

    await user.click(screen.getByRole('button', { name: '行政区划邮编对照信息查询' }))
    const administrativeFilters = screen.getByRole('region', { name: '行政区划邮编对照信息查询条件' })
    const administrativeCode = within(administrativeFilters).getByLabelText('行政区划代码')
    await user.type(administrativeCode, '12345')
    await user.click(within(administrativeFilters).getByRole('button', { name: '查询' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请输入 6 位行政区划代码')
    await user.clear(administrativeCode)
    await user.type(administrativeCode, administrative.administrativeCode)
    await user.click(within(administrativeFilters).getByRole('button', { name: '查询' }))
    const administrativeResults = screen.getByRole('region', { name: '行政区划邮编对照信息结果' })
    expect(within(administrativeResults).getByRole('cell', { name: administrative.administrativeName })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '层级集散关系查询' }))
    const hierarchyFilters = screen.getByRole('region', { name: '层级集散关系查询条件' })
    const deliveryCode = within(hierarchyFilters).getByLabelText('投递局区域码')
    await user.type(deliveryCode, '1234567')
    await user.click(within(hierarchyFilters).getByRole('button', { name: '查询' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请输入 8 位投递局区域码')
    await user.clear(deliveryCode)
    await user.type(deliveryCode, hierarchy.deliveryRegionCode)
    await user.click(within(hierarchyFilters).getByRole('button', { name: '查询' }))
    const hierarchyResults = screen.getByRole('region', { name: '层级集散关系信息结果' })
    expect(within(hierarchyResults).getByRole('cell', { name: hierarchy.institutionName })).toBeInTheDocument()
  })
})
