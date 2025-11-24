import dayjs from 'dayjs';
import type { Action } from '@/types';
import { worldState } from '@/core/state/WorldState';
import { eventBus } from '@/core/events/EventBus';

export class ActionExecutor {
  execute(action: Action) {
    eventBus.emit('action.started', action);
    if (action.type === 'Sleep') {
      worldState.setActivity('sleeping');
      worldState.setMemory({ lastSleepStart: dayjs().valueOf() });
      eventBus.emit('action.ended', action);
      return true;
    }
    if (action.type === 'WakeUp') {
      worldState.setActivity('idle');
      worldState.setMemory({ lastWakeTime: dayjs().valueOf() });
      eventBus.emit('action.ended', action);
      return true;
    }
    if (action.type === 'GoToSchool') {
      worldState.setActivity('commuting');
      eventBus.emit('action.ended', action);
      return true;
    }
    if (action.type === 'StudyAtSchool') {
      worldState.setLocation('school');
      worldState.setActivity('studying');
      worldState.setMemory({ lastSchoolArrival: dayjs().valueOf() });
      eventBus.emit('action.ended', action);
      return true;
    }
    if (action.type === 'Idle') {
      eventBus.emit('action.ended', action);
      return true;
    }
    return false;
  }
}

export const actionExecutor = new ActionExecutor();

