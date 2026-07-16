// TIME HELPERS OVER MINUTES-SINCE-MIDNIGHT BLOCK TIMES AND ISO TRIP DATES.

export const SNAP_INCREMENT_MIN = 15;

export function fmt_time(min: number): string {
  const clamped = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(clamped / 60);
  const m = clamped % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function fmt_time_range(start: number, end: number): string {
  return `${fmt_time(start)} – ${fmt_time(end)}`;
}

// RAIL VARIANT: ALWAYS "3:00" / "12:15" — THE AM/PM RENDERS ON ITS OWN LINE.
export function fmt_clock(min: number): string {
  const clamped = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(clamped / 60);
  const m = clamped % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')}`;
}

export function fmt_period(min: number): string {
  const clamped = ((min % 1440) + 1440) % 1440;
  return Math.floor(clamped / 60) < 12 ? 'AM' : 'PM';
}

export function fmt_duration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} m`;
}

export function snap_time(min: number, increment = SNAP_INCREMENT_MIN): number {
  return Math.round(min / increment) * increment;
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function parse_iso(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function weekday_short(date: string): string {
  return WEEKDAYS[parse_iso(date).getDay()];
}

export function weekday_long(date: string): string {
  return WEEKDAYS_LONG[parse_iso(date).getDay()];
}

export function day_of_month(date: string): number {
  return parse_iso(date).getDate();
}

export function month_name(date: string): string {
  return MONTHS[parse_iso(date).getMonth()];
}

// "JUNE 10 – 14" (SAME MONTH) OR "JUNE 28 – JULY 2".
export function fmt_date_range(start: string, end: string): string {
  const s = parse_iso(start);
  const e = parse_iso(end);
  const s_label = `${MONTHS[s.getMonth()]} ${s.getDate()}`;
  if (s.getMonth() === e.getMonth()) return `${s_label} – ${e.getDate()}`;
  return `${s_label} – ${MONTHS[e.getMonth()]} ${e.getDate()}`;
}

export function days_between(start: string, end: string): number {
  const ms = parse_iso(end).getTime() - parse_iso(start).getTime();
  return Math.round(ms / 86400000);
}

export function add_days(date: string, days: number): string {
  const d = parse_iso(date);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function days_until(date: string, from: Date = new Date()): number {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((parse_iso(date).getTime() - today.getTime()) / 86400000);
}
