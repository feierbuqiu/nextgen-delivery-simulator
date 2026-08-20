import { AccessExperience } from '../features/access/AccessExperience'
import { createBrowserDependencies, type AppDependencies } from './dependencies'
import { StorageAvailabilityBanner } from './StorageAvailabilityBanner'

const browserDependencies = createBrowserDependencies()

interface AppProps {
  dependencies?: AppDependencies
}

export function App({ dependencies = browserDependencies }: AppProps) {
  return (
    <>
      <StorageAvailabilityBanner monitor={dependencies.storageMonitor} />
      <AccessExperience
        customerRepository={dependencies.customerRepository}
        repository={dependencies.accessRepository}
        serviceRepository={dependencies.serviceRepository}
      />
    </>
  )
}
