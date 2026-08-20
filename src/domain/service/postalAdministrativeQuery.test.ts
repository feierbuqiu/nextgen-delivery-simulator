import { describe, expect, it } from 'vitest'

import { queryPostalAdministrativeDivisions } from './postalAdministrativeQuery'

describe('邮编行政区划查询', () => {
  it('用完整地址查询 GIS 投影', () => {
    expect(queryPostalAdministrativeDivisions(
      '瀚原省栖沄市景麓区新程路 22 号',
      'gis',
    )).toEqual([expect.objectContaining({
      queryResult: '查询成功',
      matchedBy: 'gis',
      administrativeCode: '990022000000',
      fullAddressDescription: '瀚原省栖沄市景麓区',
      provinceCode: '970001',
      provinceName: '瀚原省',
      prefectureCode: '980001',
      prefectureName: '栖沄市',
      countyCode: '990022',
      countyName: '景麓区',
      postalCode: '110022',
    })])
  })

  it('GIS 未命中时使用营业渠道匹配兜底', () => {
    expect(queryPostalAdministrativeDivisions('景麓区新程路 22 号', 'gis')[0])
      .toMatchObject({
        queryResult: '查询成功',
        matchedBy: 'administrative-fallback',
        countyName: '景麓区',
      })
  })

  it('按行政区划直接匹配多条地址并保留失败行', () => {
    const rows = queryPostalAdministrativeDivisions(
      '澜京市栖台区云杉路 11 号\n不存在的地址',
      'administrative',
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      matchedBy: 'administrative',
      countyName: '栖台区',
      postalCode: '380001',
    })
    expect(rows[1]).toMatchObject({
      inputAddress: '不存在的地址',
      queryResult: '查询失败',
      matchedBy: null,
    })
  })

  it('拒绝空输入、超过百条和相互矛盾的层级', () => {
    expect(() => queryPostalAdministrativeDivisions('', 'gis'))
      .toThrow('请输入邮件详细地址信息。')
    expect(() => queryPostalAdministrativeDivisions(
      Array.from({ length: 101 }, (_, index) => `地址 ${index}`).join('\n'),
      'gis',
    )).toThrow('一次最多支持 100 条地址查询。')
    expect(queryPostalAdministrativeDivisions(
      '澄岐省瀚原省栖沄市景麓区新程路 22 号',
      'administrative',
    )[0]?.queryResult).toBe('查询失败')
  })
})
