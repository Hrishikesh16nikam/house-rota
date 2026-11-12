import { useState } from 'react';
import { TbArrowsExchange, TbBell, TbBeach, TbChevronRight, TbDeviceMobile, TbHourglass, TbWifiOff, TbX } from 'react-icons/tb';
import { post } from '../api.ts';
import { MyDutyRow, UpNext } from '../components/duty.tsx';
import { Avatar, Empty, Loading } from '../components/ui.tsx';
import { dayLong, greeting, phrase, shortDate } from '../format.ts';
import { useApi } from '../hooks.ts';
import { DutyIcon } from '../icons.tsx';
import { isIOS, isStandalone, pushSupported } from '../pwa.ts';
import { useToast } from '../toast.tsx';
import type { Assignment, House, Member, Swap, Week } from '../types.ts';

/** Today's trash first, then weekly duties, then later trash days. */
function mostUrgent(open: Assignment[], today: string): Assignment | undefined {
  const rank = (a: Assignment) => (a.date === today ? 0 : !a.date ? 1 : 2);
  return [...open].filter((a) => !a.date || a.date >= today).sort((x, y) => rank(x) - rank(y) || (x.date ?? '').localeCompare(y.date ?? ''))[0];
}

export function Home({ me, house, go }: { me: Member; house: House; go: (p: string) => void }) {
  const week = useApi<Week>('/api/weeks/current');
  const next = useApi<Week>('/api/weeks/next');
  const swaps = useApi<{ swaps: Swap[] }>('/api/swaps');
  const reload = () => {
    void week.reload();
    void next.reload();
    void swaps.reload();
  };

  if (!week.data) return week.error ? <Empty icon={TbWifiOff} title={week.error} /> : <Loading />;
  const w = week.data;
  const mine = [...w.weekly, ...w.trash].filter((a) => a.memberId === me.id);
  const open = mine.filter((a) => a.status === 'pending');
  const done = mine.filter((a) => a.status === 'done' || a.status === 'confirmed').length;
  const upNext = mostUrgent(open, w.today);
  const weekOff = !w.weekly.some((a) => a.memberId === me.id);
  const incoming = (swaps.data?.swaps ?? []).filter((s) => s.target.id === me.id);
  const outgoing = (swaps.data?.swaps ?? []).filter((s) => s.requester.id === me.id);
  const toCheck = [...w.weekly, ...w.trash].filter((a) => a.status === 'done' && a.memberId !== me.id);
  const nextMine = next.data?.weekly.filter((a) => a.memberId === me.id) ?? [];

  return (
    <div className="screen">
      <header className="hello">
        <div>
          <p className="muted small">{shortDate(w.dates[0])} – {shortDate(w.dates[6])}</p>
          <h1>{greeting()}, {me.name}</h1>
        </div>
        <button className="avatar-btn" onClick={() => go('/me')} aria-label="Your profile"><Avatar name={me.name} color={me.color} size={36} /></button>
      </header>

      <SetupBanner go={go} />

      {upNext ? (
        <UpNext a={upNext} me={me} house={house} week={w} onChanged={reload} />
      ) : (
        <section className="all-done">
          <strong>You're done for this week</strong>
          <span className="muted small">Your next duties appear on Monday.</span>
        </section>
      )}

      <div className="stats">
        <div className="stat"><span className="stat-label">Left this week</span><span className="stat-value">{open.length}</span></div>
        <div className="stat"><span className="stat-label">Done</span><span className="stat-value">{done}</span></div>
      </div>

      {incoming.map((s) => <SwapRequest key={s.id} s={s} onDone={reload} />)}

      <section>
        <div className="section-head">
          <h2>Your week</h2>
          {weekOff && <span className="tag"><TbBeach size={14} aria-hidden="true" /> Week off from weekly duties</span>}
        </div>
        {mine.length === 0 ? (
          <Empty icon={TbBeach} title="Nothing assigned to you this week" />
        ) : (
          <ul className="list-card">{mine.map((a) => <MyDutyRow key={a.id} a={a} me={me} house={house} week={w} onChanged={reload} />)}</ul>
        )}
        {outgoing.map((s) => (
          <p key={s.id} className="muted small waiting"><TbHourglass size={14} aria-hidden="true" /> Waiting for {s.target.name} to answer about your {phrase(s.assignment)}.</p>
        ))}
      </section>

      {toCheck.length > 0 && (
        <section>
          <div className="section-head"><h2>Help check</h2></div>
          <ul className="list-card">
            {toCheck.map((a) => (
              <li key={a.id}>
                <button className="link-row" onClick={() => go('/house')}>
                  <span className="duty-icon"><DutyIcon icon={a.icon} name={a.dutyName} kind={a.kind} /></span>
                  <span className="link-row-text"><strong>{a.memberName}</strong> finished {phrase(a)}</span>
                  <TbChevronRight size={18} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {nextMine.length > 0 && (
        <section>
          <div className="section-head"><h2>Next week</h2></div>
          <p className="muted">{nextMine.map((a) => a.dutyName).join(', ')}</p>
        </section>
      )}
    </div>
  );
}

function SwapRequest({ s, onDone }: { s: Swap; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const decide = async (d: 'accept' | 'decline') => {
    setBusy(true);
    try {
      await post(`/api/swaps/${s.id}/${d}`);
      toast(d === 'accept' ? 'Swap accepted, the rota is updated' : 'Swap declined');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="notice-card">
      <div className="notice-head"><TbArrowsExchange size={18} aria-hidden="true" /><strong>Swap request from {s.requester.name}</strong></div>
      <p>
        Take their {phrase(s.assignment)}
        {s.tradeFor ? <> and they take your {phrase(s.tradeFor)}</> : null}.
        {s.assignment.date && <span className="muted"> That's on {dayLong(s.assignment.date)}.</span>}
      </p>
      <div className="row-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => decide('accept')}>Accept</button>
        <button className="btn" disabled={busy} onClick={() => decide('decline')}>Decline</button>
      </div>
    </section>
  );
}

function SetupBanner({ go }: { go: (p: string) => void }) {
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('rota-banner') === '1');
  if (dismissed) return null;
  const close = () => {
    sessionStorage.setItem('rota-banner', '1');
    setDismissed(true);
  };
  const needsInstall = isIOS() && !isStandalone();
  const needsPush = pushSupported() && Notification.permission === 'default';
  if (!needsInstall && !needsPush) return null;
  const Icon = needsInstall ? TbDeviceMobile : TbBell;
  return (
    <div className="banner">
      <Icon size={18} aria-hidden="true" />
      <p>{needsInstall ? 'Add Rota to your Home Screen to get reminders.' : 'Turn on reminders so you never miss a duty.'}</p>
      <button className="btn btn-sm" onClick={() => go('/me/reminders')}>{needsInstall ? 'Show how' : 'Turn on'}</button>
      <button className="icon-btn" onClick={close} aria-label="Dismiss"><TbX size={16} /></button>
    </div>
  );
}
