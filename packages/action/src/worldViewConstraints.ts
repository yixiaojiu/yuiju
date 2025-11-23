import type { Constraints } from './types'

// 世界观约束映射：允许地点与设备列表（静态）

export const constraints: Constraints = {
  allowedLocations: ['home', 'school'],
  allowedDevices: ['phone']
}
