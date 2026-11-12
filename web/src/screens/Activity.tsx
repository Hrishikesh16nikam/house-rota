import type { IconType } from 'react-icons';
import {
  TbAlertCircle, TbArrowBackUp, TbArrowsExchange, TbBellRinging, TbCalendarPlus, TbCircleCheck, TbEdit, TbFlag, TbHistory,
  TbHome, TbPhotoPlus, TbPlaneArrival, TbPlaneDeparture, TbPlayerSkipForward, TbRefresh, TbScale, TbShieldCheck, TbThumbUp,
  TbUserCheck, TbUserMinus, TbUserPlus, TbWifiOff, TbX,
} from 'react-icons/tb';
import { Empty, Loading } from '../components/ui.tsx';
import { ago, shortDate } from '../format.ts';
import { useApi } from '../hooks.ts';
import type { HistoryEvent } from '../types.ts';

type Tone = 'good' | 'bad' | 'accent' | 'muted';
const D = (e: HistoryEvent) => e.detail as Record<string, string>;
const cap = (s: string | null) => (s ? s[0].toUpperCase() + s.slice(1) : 'A duty');

const TEXT: Record<string, (e: HistoryEvent) => [IconType, Tone, string]> = {
  'duty.done': (e) => [TbCircleCheck, 'good', `${e.actor} finished ${e.what}`],
  'duty.confirmed': (e) => [TbThumbUp, 'good', `${e.actor} confirmed ${e.what}`],
  'duty.auto_confirmed': (e) => [TbShieldCheck, 'good', `${cap(e.what)} counted automatically`],
  'duty.flagged': (e) => [TbFlag, 'bad', `${e.actor} flagged ${e.what}: “${D(e).reason}”`],
  'duty.flag_accepted': (e) => [TbScale, 'muted', `${e.actor} counted ${e.what} as done`],
  'duty.flag_redo': (e) => [TbRefresh, 'bad', `${e.actor} sent ${e.what} back to redo`],
  'duty.missed': (e) => [TbAlertCircle, 'bad', `${cap(e.what)} was missed`],
  'duty.nudged': (e) => [TbBellRinging, 'muted', `Someone nudged about ${e.what}`],
  'duty.covered': (e) => [TbUserCheck, 'accent', `${D(e).cover} is covering ${e.what} for ${D(e).away}`],
  'duty.skipped': (e) => [TbPlayerSkipForward, 'muted', `${cap(e.what)} skipped, nobody available`],
  'duty.photo_added': (e) => [TbPhotoPlus, 'muted', `${e.actor} added a photo to ${e.what}`],
  'duty.edited': (e) => [TbEdit, 'muted', `${e.actor} edited ${D(e).name}`],
  'swap.requested': (e) => [TbArrowsExchange, 'accent', `${e.actor} asked ${D(e).to} to swap ${e.what}`],
  'swap.accepted': (e) => [TbArrowsExchange, 'good', `${e.actor} took over ${e.what}`],
  'swap.declined': (e) => [TbX, 'muted', `${e.actor} couldn't swap ${e.what}`],
  'swap.cancelled': (e) => [TbArrowBackUp, 'muted', `${e.actor} cancelled a swap request`],
  'member.away': (e) => [TbPlaneDeparture, 'accent', `${D(e).member} is away ${shortDate(D(e).from)} – ${shortDate(D(e).to)}`],
  'member.away_removed': (e) => [TbPlaneArrival, 'muted', `${D(e).member} is staying home after all`],
  'member.joined': (e) => [TbUserPlus, 'good', `${D(e).name} joined the house`],
  'member.added': (e) => [TbUserPlus, 'muted', `${D(e).name} was added`],
  'member.deactivated': (e) => [TbUserMinus, 'muted', `${D(e).name} moved out`],
  'member.reactivated': (e) => [TbHome, 'muted', `${D(e).name} is back`],
  'week.planned': (e) => [TbCalendarPlus, 'muted', `Week of ${shortDate(D(e).week)} planned`],
  'house.created': (e) => [TbHome, 'muted', `${D(e).name} was created`],
};

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export function Activity() {
  const { data, error } = useApi<{ events: HistoryEvent[] }>('/api/history');
  if (!data) return error ? <Empty icon={TbWifiOff} title={error} /> : <Loading />;
  const events = data.events.filter((e) => TEXT[e.type] && e.type !== 'week.planned');
  const groups: { day: string; items: HistoryEvent[] }[] = [];
  for (const e of events) {
    const day = dayLabel(e.ts);
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
    groups.at(-1)!.items.push(e);
  }
  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Activity</h1>
        <p className="muted small">A permanent record of the house. Entries can't be edited or deleted.</p>
      </header>
      {groups.length === 0 && <Empty icon={TbHistory} title="No activity yet" />}
      {groups.map((g) => (
        <section key={g.day}>
          <h2 className="day-label">{g.day}</h2>
          <ul className="list-card">
            {g.items.map((e) => {
              const [Icon, tone, text] = TEXT[e.type](e);
              return (
                <li key={e.id} className="feed-item">
                  <span className={`feed-icon tone-${tone}`} aria-hidden="true"><Icon size={16} /></span>
                  <span className="feed-text">{text}</span>
                  <time className="feed-time" dateTime={e.ts}>{ago(e.ts)}</time>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
