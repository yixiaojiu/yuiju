import { PartOfDay, TimeWindow, WorldActivity } from '@/types/time';

export const PartOfDayWindow: Record<PartOfDay | WorldActivity, TimeWindow> = {
  [PartOfDay.NIGHT]: { startHour: 0, endHour: 6 },
  [PartOfDay.MORNING]: { startHour: 6, endHour: 12 },
  [PartOfDay.AFTERNOON]: { startHour: 12, endHour: 18 },
  [PartOfDay.EVENING]: { startHour: 18, endHour: 24 },
  [WorldActivity.SCHEOOL]: { startHour: 8, endHour: 15 },
};
