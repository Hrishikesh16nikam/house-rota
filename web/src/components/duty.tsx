import { useRef, useState, type FormEvent, type ReactElement } from 'react';
import { TbArrowsExchange, TbBellRinging, TbCamera, TbCheck, TbFlag, TbThumbUp } from 'react-icons/tb';
import { api, post } from '../api.ts';
import { dayLong, dayShort, pts, STATUS, title, phrase } from '../format.ts';
import { DutyIcon } from '../icons.tsx';
import { compressPhoto } from '../photo.ts';
import { useToast } from '../toast.tsx';
import type { Assignment, House, Member, Week } from '../types.ts';
import { Avatar, Pill, Sheet } from './ui.tsx';

export interface DutyProps {
  a: Assignment;
  me: Member;
  house: House;
  week: Week;
  onChanged: () => void;
}

const colorOf = (house: House, id: number | null) => house.members.find((m) => m.id === id)?.color;

function notYet(a: Assignment, week: Week) {
  return Boolean((a.date && a.date > week.today) || a.weekStart > week.today);
}

/** Runs an action with a toast, then refreshes the page data. */
function useAction(onChanged: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      onChanged();
      return true;
    } catch (e) {
      toast((e as Error).message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** The most urgent open duty for this person, as a solid accent card. */
export function UpNext({ a, me, house, week, onChanged }: DutyProps) {
  const { busy, run } = useAction(onChanged);
  const [sheet, setSheet] = useState(false);
  const early = notYet(a, week);
  const when = a.date ? (a.date === week.today ? 'Tonight' : dayLong(a.date)) : 'Due Sunday';
  return (
    <section className="up-next" aria-label="Up next">
      <div className="up-next-top">
        <span className="up-next-label">Up next</span>
        <span className="up-next-pts">{pts(a.points)}</span>
      </div>
      <div className="up-next-main">
        <span className="up-next-icon"><DutyIcon icon={a.icon} name={a.dutyName} kind={a.kind} size={22} /></span>
        <div>
          <div className="up-next-title">{a.kind === 'trash' ? 'Trash' : a.dutyName}</div>
          <div className="up-next-when">{when}</div>
        </div>
      </div>
      <div className="up-next-actions">
        {!early && (
          <button className="btn btn-on-accent" disabled={busy} onClick={() => run(() => post(`/api/assignments/${a.id}/done`), `${title(a)} marked done`)}>
            <TbCheck size={16} aria-hidden="true" /> Mark done
          </button>
        )}
        <button className="btn btn-on-accent-ghost" onClick={() => setSheet(true)}>Details</button>
      </div>
      {sheet && <DutySheet a={a} me={me} house={house} week={week} onChanged={onChanged} onClose={() => setSheet(false)} />}
    </section>
  );
}

/** A row for one of your own duties (Home screen). */
export function MyDutyRow({ a, me, house, week, onChanged }: DutyProps) {
  const { busy, run } = useAction(onChanged);
  const [sheet, setSheet] = useState<'swap' | 'more' | null>(null);
  const st = STATUS[a.status];
  const early = notYet(a, week);
  return (
    <li className={`duty-row tone-${st.tone}`}>
      <button className="duty-row-main" onClick={() => setSheet('more')} aria-label={`${title(a)} details`}>
        <span className="duty-icon"><DutyIcon icon={a.icon} name={a.dutyName} kind={a.kind} /></span>
        <span className="duty-row-text">
          <span className="duty-row-title">{title(a)}</span>
          <span className="duty-row-sub">
            {pts(a.points)}
            {a.originalMemberName && a.originalMemberId !== me.id && <> · covering for {a.originalMemberName}</>}
          </span>
        </span>
        <Pill tone={st.tone}>{st.label}</Pill>
      </button>
      {a.status === 'pending' && (
        <div className="duty-row-actions">
          {early ? (
            <span className="hint">{a.date ? `On ${dayLong(a.date)}` : 'Starts Monday'}</span>
          ) : (
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => post(`/api/assignments/${a.id}/done`), `${title(a)} marked done`)}>
              <TbCheck size={15} aria-hidden="true" /> Mark done
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setSheet('swap')}><TbArrowsExchange size={15} aria-hidden="true" /> Swap</button>
        </div>
      )}
      {sheet === 'swap' && <SwapSheet a={a} me={me} house={house} week={week} onClose={() => setSheet(null)} onDone={onChanged} />}
      {sheet === 'more' && <DutySheet a={a} me={me} house={house} week={week} onChanged={onChanged} onClose={() => setSheet(null)} />}
    </li>
  );
}

/** One weekly duty in the house board. */
export function BoardRow({ a, me, house, week, onChanged }: DutyProps) {
  const [open, setOpen] = useState(false);
  const st = STATUS[a.status];
  const mine = a.memberId === me.id;
  return (
    <li>
      <button className={`board-row tone-${st.tone}${mine ? ' is-mine' : ''}`} onClick={() => setOpen(true)}>
        <span className={`dot dot-${st.tone}`} title={st.label} />
        <span className="board-icon"><DutyIcon icon={a.icon} name={a.dutyName} kind={a.kind} /></span>
        <span className="board-name">{a.dutyName}{a.slot > 0 ? ` ${a.slot + 1}` : ''}</span>
        <span className="board-person">
          <Avatar name={a.memberName} color={colorOf(house, a.memberId)} size={22} />
          <span>{mine ? 'You' : a.memberName ?? 'Nobody'}</span>
        </span>
      </button>
      {open && <DutySheet a={a} me={me} house={house} week={week} onChanged={onChanged} onClose={() => setOpen(false)} />}
    </li>
  );
}

/** One day in the trash rotation. */
export function TrashDay({ a, me, house, week, onChanged }: DutyProps) {
  const [open, setOpen] = useState(false);
  const st = STATUS[a.status];
  const today = a.date === week.today;
  const mine = a.memberId === me.id;
  return (
    <>
      <button className={`trash-day tone-${st.tone}${today ? ' today' : ''}${mine ? ' is-mine' : ''}`} onClick={() => setOpen(true)}>
        <span className="trash-dow">{today ? 'Today' : dayShort(a.date!)}</span>
        <Avatar name={a.memberName} color={colorOf(house, a.memberId)} size={28} />
        <span className="trash-who">{mine ? 'You' : a.memberName ?? '—'}</span>
        <span className={`dot dot-${st.tone}`} />
      </button>
      {open && <DutySheet a={a} me={me} house={house} week={week} onChanged={onChanged} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Details and every action that makes sense for this viewer. */
export function DutySheet({ a, me, house, week, onChanged, onClose }: DutyProps & { onClose: () => void }) {
  const { busy, run } = useAction(onChanged);
  const toast = useToast();
  const [mode, setMode] = useState<'main' | 'flag' | 'swap'>('main');
  const file = useRef<HTMLInputElement>(null);
  const mine = a.memberId === me.id;
  const st = STATUS[a.status];
  const early = notYet(a, week);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    if (await run(fn, ok)) onClose();
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      const blob = await compressPhoto(f);
      await act(() => api(`/api/assignments/${a.id}/photo`, { method: 'PUT', raw: blob }), 'Photo added. It is deleted after 7 days.');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  if (mode === 'swap') return <SwapSheet a={a} me={me} house={house} week={week} onClose={onClose} onDone={onChanged} />;
  if (mode === 'flag') return <FlagSheet a={a} onClose={onClose} onDone={onChanged} />;

  const actions: ReactElement[] = [];
  if (mine && a.status === 'pending') {
    if (!early) actions.push(<button key="done" className="btn btn-primary btn-lg" disabled={busy} onClick={() => act(() => post(`/api/assignments/${a.id}/done`), `${title(a)} marked done`)}><TbCheck size={18} aria-hidden="true" /> Mark done</button>);
    actions.push(<button key="swap" className="btn btn-lg" onClick={() => setMode('swap')}><TbArrowsExchange size={18} aria-hidden="true" /> Ask someone to swap</button>);
  }
  if (mine && a.status === 'done') {
    actions.push(<button key="photo" className="btn btn-lg" disabled={busy} onClick={() => file.current?.click()}><TbCamera size={18} aria-hidden="true" /> {a.hasPhoto ? 'Replace photo' : 'Add a photo as proof'}</button>);
  }
  if (!mine && a.status === 'done') {
    actions.push(
      <button key="ok" className="btn btn-primary btn-lg" disabled={busy} onClick={() => act(() => post(`/api/assignments/${a.id}/confirm`), 'Confirmed')}><TbThumbUp size={18} aria-hidden="true" /> Looks good</button>,
      <button key="flag" className="btn btn-lg" onClick={() => setMode('flag')}><TbFlag size={18} aria-hidden="true" /> Not quite done</button>,
    );
  }
  if (!mine && a.status === 'pending' && a.memberId !== null && !early) {
    actions.push(<button key="nudge" className="btn btn-lg" disabled={busy} onClick={() => act(() => post(`/api/assignments/${a.id}/nudge`), 'Nudge sent anonymously')}><TbBellRinging size={18} aria-hidden="true" /> Send an anonymous nudge</button>);
  }
  if (a.status === 'flagged' && me.isAdmin) {
    actions.push(
      <button key="accept" className="btn btn-primary btn-lg" disabled={busy} onClick={() => act(() => post(`/api/assignments/${a.id}/resolve`, { outcome: 'accept' }), 'Counted as done')}>Count it as done</button>,
      <button key="redo" className="btn btn-lg" disabled={busy} onClick={() => act(() => post(`/api/assignments/${a.id}/resolve`, { outcome: 'redo' }), 'Sent back to redo')}>Needs a redo</button>,
    );
  }

  return (
    <Sheet title={title(a)} onClose={onClose}>
      <div className="sheet-summary">
        <span className="duty-icon lg"><DutyIcon icon={a.icon} name={a.dutyName} kind={a.kind} size={22} /></span>
        <div className="sheet-summary-text">
          <div className="sheet-person">
            <Avatar name={a.memberName} color={colorOf(house, a.memberId)} size={22} />
            <strong>{mine ? 'You' : a.memberName ?? 'Nobody'}</strong>
          </div>
          <div className="muted small">
            {pts(a.points)}
            {a.originalMemberName && a.originalMemberId !== a.memberId && <> · originally {a.originalMemberName}</>}
          </div>
        </div>
        <Pill tone={st.tone}>{st.label}</Pill>
      </div>
      {a.hasPhoto && <img className="proof" src={`/api/assignments/${a.id}/photo`} alt={`Photo of ${title(a)}`} />}
      {a.status === 'done' && !mine && <p className="muted small">If nobody flags it within 24 hours, it counts automatically.</p>}
      {early && a.status === 'pending' && <p className="muted small">{a.date ? `This is on ${dayLong(a.date)}.` : 'This is next week.'}</p>}
      {actions.length > 0 ? <div className="stack-sm">{actions}</div> : <p className="muted small">Nothing to do here right now.</p>}
      <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => upload(e.target.files?.[0])} />
    </Sheet>
  );
}

function SwapSheet({ a, me, house, week, onClose, onDone }: { a: Assignment; me: Member; house: House; week: Week; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const duty = house.duties.find((d) => d.id === a.dutyId);
  const people = house.members.filter((m) => m.active && m.joined && m.id !== me.id && (!duty?.eligible || duty.eligible.includes(m.id)));
  const [target, setTarget] = useState<number | null>(null);
  const [trade, setTrade] = useState<number | null>(null);
  const theirs = target === null ? [] : [...week.weekly, ...week.trash].filter((x) => {
    if (x.memberId !== target || x.status !== 'pending') return false;
    const d = house.duties.find((dd) => dd.id === x.dutyId);
    return !d?.eligible || d.eligible.includes(me.id);
  });

  const send = async () => {
    try {
      await post('/api/swaps', { assignmentId: a.id, targetId: target, targetAssignmentId: trade });
      toast('Swap request sent');
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Sheet title={`Swap ${phrase(a)}`} onClose={onClose}>
      {people.length === 0 ? (
        <p className="muted">Nobody else can do this one.</p>
      ) : (
        <div className="stack">
          <p className="label">Who do you want to ask?</p>
          <div className="choice-grid">
            {people.map((m) => (
              <button key={m.id} className={target === m.id ? 'choice selected' : 'choice'} aria-pressed={target === m.id} onClick={() => { setTarget(m.id); setTrade(null); }}>
                <Avatar name={m.name} color={m.color} size={30} />
                <span>{m.name}</span>
              </button>
            ))}
          </div>
          {target !== null && (
            <>
              <p className="label">In return</p>
              <div className="stack-sm">
                <button className={trade === null ? 'option selected' : 'option'} aria-pressed={trade === null} onClick={() => setTrade(null)}>
                  Nothing, they take it <span className="muted small">and earn the points</span>
                </button>
                {theirs.map((x) => (
                  <button key={x.id} className={trade === x.id ? 'option selected' : 'option'} aria-pressed={trade === x.id} onClick={() => setTrade(x.id)}>
                    <DutyIcon icon={x.icon} name={x.dutyName} kind={x.kind} size={16} /> I'll take their {phrase(x)}
                  </button>
                ))}
              </div>
              <button className="btn btn-primary btn-lg" onClick={send}>Send request</button>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

function FlagSheet({ a, onClose, onDone }: { a: Assignment; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await post(`/api/assignments/${a.id}/flag`, { reason });
      toast(`Flagged. ${a.memberName} has been told what's left.`);
      onDone();
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <Sheet title="What still needs doing?" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">{a.memberName} sees exactly what you write. If you disagree, the house admin decides.</p>
        <textarea className="input" rows={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="The sink still has dishes in it" required />
        <button className="btn btn-danger btn-lg" disabled={!reason.trim()}>Flag it</button>
      </form>
    </Sheet>
  );
}
