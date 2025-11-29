export enum PartOfDay {
  NIGHT = 'night',
  MORNING = 'morning',
  AFTERNOON = 'afternoon',
  EVENING = 'evening',
}

export enum WorldActivity {
  SCHEOOL = 'school',
}

export interface TimeWindow {
  startHour: number;
  endHour: number;
}
