import type { AccessRepository } from '../domain/access/repository'
import type { CustomerRepository } from '../domain/customer/repository'
import type { ServiceRepository } from '../domain/service/repository'
import { IndexedDbAccessRepository } from '../infrastructure/indexeddb/IndexedDbAccessRepository'
import { IndexedDbAvailabilityMonitor } from '../infrastructure/indexeddb/IndexedDbAvailability'
import { IndexedDbCustomerRepository } from '../infrastructure/indexeddb/IndexedDbCustomerRepository'
import { IndexedDbServiceRepository } from '../infrastructure/indexeddb/IndexedDbServiceRepository'

/** 应用入口依赖的端口集合。界面层只依赖领域接口，不直接选择存储实现。 */
export interface AppDependencies {
  accessRepository: AccessRepository
  customerRepository: CustomerRepository
  serviceRepository: ServiceRepository
  storageMonitor: IndexedDbAvailabilityMonitor
}

/** 浏览器运行时的唯一装配入口。测试或未来适配器可以替换这里的实现。 */
export function createBrowserDependencies(): AppDependencies {
  const storageMonitor = new IndexedDbAvailabilityMonitor()
  return {
    accessRepository: new IndexedDbAccessRepository(undefined, storageMonitor.report),
    customerRepository: new IndexedDbCustomerRepository(undefined, storageMonitor.report),
    serviceRepository: new IndexedDbServiceRepository(undefined, storageMonitor.report),
    storageMonitor,
  }
}
