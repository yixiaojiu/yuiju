export type Location = 'home' | 'school';
export type Activity = 'idle' | 'sleeping' | 'commuting' | 'studying';
export type Device = 'phone';

export type ActionType = 'Sleep' | 'WakeUp' | 'GoToSchool' | 'StudyAtSchool' | 'Idle';

export type Action = {
  type: ActionType;
  preemptive?: boolean;
  rationale?: string;
};

export type Memory = {
  lastSleepStart?: number;
  lastWakeTime?: number;
  lastSchoolArrival?: number;
};

export type WorldStateShape = {
  location: Location;
  activity: Activity;
  energy: number;
  devices: Device[];
  memory: Memory;
};

export type Constraints = {
  allowedLocations: Location[];
  allowedDevices: Device[];
};

export type SchoolWindow = {
  startMinutes: number;
  endMinutes: number;
};

export type Config = {
  timezoneOffsetHours?: number;
  schoolWindow?: SchoolWindow;
  rateLimitPerMinutes?: number;
  cooldownMs?: number;
};

export type ExternalEvent = {
  type: 'external.message';
  payload: unknown;
};

