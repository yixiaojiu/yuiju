import type { WorldState, Activity, Location } from './types'

// 世界状态：初始值与原子更新函数

export const initialWorldState = (): WorldState => ({
  location: 'home',
  activity: 'idle',
  energy: 100,
  devices: { phone: { hasNewInfo: false } },
  memory: {}
})

export const setLocation = (state: WorldState, location: Location): WorldState => ({
  ...state,
  location
})

export const setActivity = (state: WorldState, activity: Activity): WorldState => ({
  ...state,
  activity
})

export const updateEnergy = (state: WorldState, delta: number): WorldState => ({
  ...state,
  energy: Math.max(0, Math.min(100, state.energy + delta))
})

export const setPhoneInfo = (state: WorldState, hasNewInfo: boolean): WorldState => ({
  ...state,
  devices: { ...state.devices, phone: { hasNewInfo } }
})

export const setMemory = (state: WorldState, memory: Partial<WorldState['memory']>): WorldState => ({
  ...state,
  memory: { ...state.memory, ...memory }
})
