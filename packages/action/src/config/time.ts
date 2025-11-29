import type { TimeConfig } from '@/types/time';

export const timeConfig: TimeConfig = {
  gates: {
    morningWakeWindow: { startHour: 6, startMinute: 0, endHour: 9, endMinute: 0 },
    goToSchoolWindow: { startHour: 8, startMinute: 30, endHour: 9, endMinute: 30 },
    goHomeAfterHour: 17,
    eveningSleepAfterHour: 21,
    noChangeNextSec: {
      MORNING_WAKE: 300,
      GO_TO_SCHOOL: 600,
      GO_HOME: 900,
      EVENING_SLEEP: 900,
    },
    nextGateTargets: [
      { hour: 6, minute: 0 },
      { hour: 8, minute: 30 },
      { hour: 17, minute: 0 },
      { hour: 21, minute: 0 },
    ],
    minNextGateDelayMs: 5 * 60 * 1000,
  },
  scenes: {
    morningWindow: { startHour: 6, startMinute: 0, endHour: 9, endMinute: 0 },
    schoolWindow: { startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 },
    afterSchoolWindow: { startHour: 17, startMinute: 0, endHour: 21, endMinute: 0 },
    eveningStartHour: 21,
    defaultSceneCooldownSec: {
      MORNING: 30,
      SCHOOL: 1800,
      HOME: 300,
      EVENING: 600,
    },
  },
  actionsTime: {
    wakeUpEarliestHour: 6,
    wakeUpLatestHour: 12,
  },
  actions: {
    cooldownSec: {
      WAKE_UP: 10,
      GO_TO_SCHOOL: 10,
      STUDY_AT_SCHOOL: 1800,
      GO_HOME: 60,
      IDLE_AT_HOME: 300,
      SLEEP: 3600,
    },
  },
  memory: {
    shortTermCapacity: 10,
  },
  runner: {
    initialDelayMs: 5000,
  },
  simulation: {
    startHour: 6,
    endHour: 23,
    stepHours: 1,
  },
};
