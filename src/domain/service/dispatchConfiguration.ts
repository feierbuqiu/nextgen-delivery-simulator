export interface SimulatedPostRoute {
  code: string
  name: string
  receivingOfficeCodes: string[]
  dispatchingOfficeName: string
  unloadingStation: string
  requiresDispatchOrderNumber: boolean
}

/**
 * 本地演练邮路只承担字段、路向和派车单控制规则，不映射现实运输网络。
 */
export const SIMULATED_POST_ROUTES: readonly SimulatedPostRoute[] = [
  {
    code: 'SIM-A01',
    name: '栖沄干线邮路',
    receivingOfficeCodes: ['99101001'],
    dispatchingOfficeName: '栖沄转运中心',
    unloadingStation: '栖沄中心站',
    requiresDispatchOrderNumber: true,
  },
  {
    code: 'SIM-B02',
    name: '澄野市内邮路',
    receivingOfficeCodes: ['99102001'],
    dispatchingOfficeName: '澄野转运班组',
    unloadingStation: '澄野营业站',
    requiresDispatchOrderNumber: false,
  },
  {
    code: 'SIM-C03',
    name: '镜海埠互换邮路',
    receivingOfficeCodes: ['99103001'],
    dispatchingOfficeName: '镜海埠互换中心',
    unloadingStation: '镜海埠互换站',
    requiresDispatchOrderNumber: true,
  },
] as const
