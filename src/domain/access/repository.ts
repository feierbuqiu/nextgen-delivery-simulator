import type { SimulatorState } from './types'

export interface AccessRepository {
  load(): Promise<SimulatorState>
  save(state: SimulatorState): Promise<void>
  restore(state: SimulatorState): Promise<SimulatorState>
  reset(): Promise<SimulatorState>
}
