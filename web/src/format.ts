import type { Assignment } from './types.ts';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const utc = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export const dow = (date: string) => (utc(date).getUTCDay() + 6) % 7;
export const dayShort = (date: string) => DAYS[dow(date)];
export const dayLong = (date: string) => LONG[dow(date)];
export const shortDate = (date: string) => utc(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const dayNum = (date: string) => utc(date).getUTCDate();

export function addDays(date: string, n: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const pts = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} pt${n === 1 ? '' : 's'}`;

/** Lower-case phrase for use mid-sentence: "trash on Monday" or "Kitchen". */
export const phrase = (a: Pick<Assignment, 'date' | 'dutyName'>) => (a.date ? `trash on ${dayLong(a.date)}` : a.dutyName);

export const title = (a: Pick<Assignment, 'date' | 'dutyName'>) => (a.date ? `Trash · ${dayLong(a.date)}` : a.dutyName);

export const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'To do', tone: 'todo' },
  done: { label: 'Waiting for a check', tone: 'wait' },
  confirmed: { label: 'Done', tone: 'good' },
  flagged: { label: 'Flagged', tone: 'bad' },
  missed: { label: 'Missed', tone: 'bad' },
  skipped: { label: 'Skipped', tone: 'muted' },
};

export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
