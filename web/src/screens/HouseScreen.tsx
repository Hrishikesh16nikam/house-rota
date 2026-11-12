import { useState } from 'react';
import { TbBeach, TbInfoCircle, TbWifiOff } from 'react-icons/tb';
import { BoardRow, TrashDay } from '../components/duty.tsx';
import { Avatar, Empty, Loading } from '../components/ui.tsx';
import { pts, shortDate } from '../format.ts';
import { useApi } from '../hooks.ts';
import type { Fairness, House, Member, Week } from '../types.ts';

export function HouseScreen({ me, house }: { me: Member; house: House }) {
  const [which, setWhich] = useState<'current' | 'next'>('current');
  const week = useApi<Week>(`/api/weeks/${which}`);
  const fair = useApi<{ members: Fairness[] }>('/api/fairness');
  const reload = () => {
    void week.reload();
    void fair.reload();
  };
  const w = week.data;
  const free = w?.free.map((id) => house.members.find((m) => m.id === id)).filter((m): m is Member => Boolean(m)) ?? [];

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>{house.name}</h1>
        <div className="segmented" role="tablist" aria-label="Week">
          <button role="tab" aria-selected={which === 'current'} className={which === 'current' ? 'on' : ''} onClick={() => setWhich('current')}>This week</button>
          <button role="tab" aria-selected={which === 'next'} className={which === 'next' ? 'on' : ''} onClick={() => setWhich('next')}>Next week</button>
        </div>
      </header>

      {!w ? week.error ? <Empty icon={TbWifiOff} title={week.error} /> : <Loading /> : (
        <>
          <p className="muted small week-range">{shortDate(w.dates[0])} – {shortDate(w.dates[6])}</p>
          {w.notes.map((n) => <div key={n} className="note"><TbInfoCircle size={16} aria-hidden="true" /> {n}</div>)}

          <section>
            <div className="section-head"><h2>Weekly duties</h2></div>
            <ul className="list-card">
              {w.weekly.map((a) => <BoardRow key={a.id} a={a} me={me} house={house} week={w} onChanged={reload} />)}
            </ul>
            {free.length > 0 && (
              <div className="week-off">
                <TbBeach size={16} aria-hidden="true" />
                {free.map((m) => <span key={m.id} className="week-off-person"><Avatar name={m.name} color={m.color} size={20} />{m.id === me.id ? 'You' : m.name}</span>)}
                <span className="muted">{free.length === 1 ? 'has' : 'have'} the week off</span>
              </div>
            )}
          </section>

          <section>
            <div className="section-head"><h2>Trash</h2><span className="muted small">One person a day, rotating</span></div>
            <div className="trash-strip">
              {w.trash.map((a) => <TrashDay key={a.id} a={a} me={me} house={house} week={w} onChanged={reload} />)}
            </div>
          </section>
        </>
      )}

      <section>
        <div className="section-head"><h2>Effort balance</h2></div>
        <p className="muted small">Points from completed duties. Heavier duties go to whoever is behind, so these stay close.</p>
        {fair.data ? <FairBars rows={fair.data.members} me={me} /> : <Loading />}
      </section>
    </div>
  );
}

function FairBars({ rows, me }: { rows: Fairness[]; me: Member }) {
  const max = Math.max(1, ...rows.map((r) => r.earned + r.planned));
  const avg = rows.reduce((s, r) => s + r.earned, 0) / (rows.length || 1);
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.memberId} className={r.memberId === me.id ? 'mine' : ''}>
          <span className="bar-who"><Avatar name={r.name} color={r.color} size={22} /> {r.memberId === me.id ? 'You' : r.name}</span>
          <span className="bar-track" aria-hidden="true">
            <span className="bar-fill" style={{ width: `${(r.earned / max) * 100}%` }} />
            <span className="bar-planned" style={{ width: `${(r.planned / max) * 100}%` }} />
            <span className="bar-avg" style={{ left: `${(avg / max) * 100}%` }} />
          </span>
          <span className="bar-num">
            {pts(r.earned)}
            {r.missed > 0 && <span className="bar-missed"> · {r.missed} missed</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
