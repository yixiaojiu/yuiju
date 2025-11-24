import type { Action, Constraints } from '@/types';
import type { WorldState } from '@/core/state/WorldState';

export class SafetyFilter {
  constructor(private constraints: Constraints) {}

  apply(action: Action, state: WorldState) {
    if (!this.constraints.allowedDevices.every(d => state.devices.includes(d))) {
      return { ok: false, reason: 'device.not.allowed' };
    }
    if (action.type === 'GoToSchool') {
      if (state.location !== 'home') return { ok: false, reason: 'location.invalid' };
    }
    if (action.type === 'StudyAtSchool') {
      if (state.location !== 'school') return { ok: false, reason: 'location.invalid' };
    }
    if (action.type === 'Sleep') {
      if (state.location !== 'home') return { ok: false, reason: 'location.invalid' };
    }
    if ((state.activity === 'sleeping' || state.activity === 'studying') && !action.preemptive) {
      return { ok: false, reason: 'non.preemptive.conflict' };
    }
    return { ok: true };
  }
}

export const defaultConstraints: Constraints = {
  allowedLocations: ['home', 'school'],
  allowedDevices: ['phone'],
};

