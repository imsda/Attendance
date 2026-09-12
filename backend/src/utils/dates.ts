export function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function localTimeKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${value('hour')}:${value('minute')}`;
}

export function isWithinDailyTimeWindow(time: string, start: string, end: string): boolean {
  if (start === end) return true;
  return start < end ? time >= start && time <= end : time >= start || time <= end;
}

function addDays(key: string, amount: number): string {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function attendancePeriods(timezone: string, now = new Date()) {
  const today = localDateKey(now, timezone);
  const date = new Date(`${today}T12:00:00Z`);
  const day = date.getUTCDay();
  const weekStart = addDays(today, -((day + 6) % 7));
  return {
    today,
    weekStart,
    monthStart: `${today.slice(0, 7)}-01`,
    yearStart: `${today.slice(0, 4)}-01-01`
  };
}

export function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
