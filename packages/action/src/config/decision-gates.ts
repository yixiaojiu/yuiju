import { worldState } from '@/state/world-state';
import { charactorState } from '@/state/charactor-state';
import { Activity, WorldLocation } from '@/types/everything';
import { ActionId } from '@/types/action';
import { timeConfig } from '@/config/time';

export interface DecisionCandidate {
  id: ActionId | 'NO_CHANGE';
  description: string;
  nextCheckSec?: number;
}

export interface DecisionGate {
  gateId: ActionId;
  candidates: DecisionCandidate[];
}

const inRange = (startHour: number, startMinute: number, endHour: number, endMinute: number) => {
  const t = worldState.time;
  const sh = t.hour();
  const sm = t.minute();
  const start = sh * 60 + sm;
  const sBound = startHour * 60 + startMinute;
  const eBound = endHour * 60 + endMinute;
  return start >= sBound && start < eBound;
};

export function resolveDecisionCandidates(): DecisionGate | null {
  const h = worldState.time.hour();
  const isWeekend = [0, 6].includes(worldState.time.day());
  if (
    inRange(
      timeConfig.gates.morningWakeWindow.startHour,
      timeConfig.gates.morningWakeWindow.startMinute,
      timeConfig.gates.morningWakeWindow.endHour,
      timeConfig.gates.morningWakeWindow.endMinute
    ) &&
    charactorState.location === WorldLocation.HOME &&
    charactorState.activity === Activity.SLEEPING
  ) {
    return {
      gateId: ActionId.WAKE_UP,
      candidates: [
        { id: ActionId.WAKE_UP, description: '在家醒来，开始新的一天。' },
        { id: 'NO_CHANGE', description: '再睡 5 分钟', nextCheckSec: timeConfig.gates.noChangeNextSec[ActionId.WAKE_UP] },
      ],
    };
  }

  if (
    inRange(
      timeConfig.gates.goToSchoolWindow.startHour,
      timeConfig.gates.goToSchoolWindow.startMinute,
      timeConfig.gates.goToSchoolWindow.endHour,
      timeConfig.gates.goToSchoolWindow.endMinute
    ) &&
    !isWeekend &&
    charactorState.location === WorldLocation.HOME &&
    (charactorState.activity === Activity.WAKE_UP || charactorState.activity === Activity.IDLE_AT_HOME)
  ) {
    return {
      gateId: ActionId.GO_TO_SCHOOL,
      candidates: [
        { id: ActionId.GO_TO_SCHOOL, description: '醒来后从家前往学校。' },
        { id: 'NO_CHANGE', description: '再等一会', nextCheckSec: timeConfig.gates.noChangeNextSec[ActionId.GO_TO_SCHOOL] },
      ],
    };
  }

  if (h >= timeConfig.gates.goHomeAfterHour && charactorState.activity === Activity.STUDY_AT_SCHOOL) {
    return {
      gateId: ActionId.GO_HOME,
      candidates: [
        { id: ActionId.GO_HOME, description: '放学后从学校回家。' },
        { id: 'NO_CHANGE', description: '再学一会', nextCheckSec: timeConfig.gates.noChangeNextSec[ActionId.GO_HOME] },
      ],
    };
  }

  if (h >= timeConfig.gates.eveningSleepAfterHour && charactorState.location === WorldLocation.HOME && charactorState.activity !== Activity.SLEEPING) {
    return {
      gateId: ActionId.SLEEP,
      candidates: [
        { id: ActionId.SLEEP, description: '晚间在家睡觉。' },
        { id: 'NO_CHANGE', description: '再熬一会', nextCheckSec: timeConfig.gates.noChangeNextSec[ActionId.SLEEP] },
      ],
    };
  }

  return null;
}

export function nextGateDelayMs(): number {
  const t = worldState.time;
  const minutes = t.hour() * 60 + t.minute();
  const targets = timeConfig.gates.nextGateTargets.map(x => x.hour * 60 + x.minute);
  const future = targets.find(m => m > minutes);
  const next = future ?? (timeConfig.gates.nextGateTargets[0].hour * 60 + 24 * 60);
  const diffMin = next - minutes;
  const diffMs = diffMin * 60 * 1000;
  return Math.max(diffMs, timeConfig.gates.minNextGateDelayMs);
}
