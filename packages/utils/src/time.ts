import dayjs, { Dayjs } from 'dayjs';
import 'dayjs/locale/zh-cn';

dayjs.locale('zh-cn');

/**
 *
 * Get formatted time with weekday
 */
export function getTimeWithWeekday(time?: Dayjs) {
  const displayTime = time ?? dayjs();

  return displayTime.format('YYYY-MM-DD HH:mm:ss') + ' ' + displayTime.format('dddd');
}
