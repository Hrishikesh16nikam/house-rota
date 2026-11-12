import { useEffect, useState, type FormEvent } from 'react';
import {
  TbArrowLeft, TbBell, TbDeviceMobile, TbHome, TbKey, TbListCheck, TbLogout, TbMinus, TbPlaneDeparture, TbPlus, TbScale,
  TbShare2, TbUsers,
} from 'react-icons/tb';
import { api, patch, post } from '../api.ts';
import { PinPad } from '../components/PinPad.tsx';
import { Avatar, Empty, Loading, Row } from '../components/ui.tsx';
import { addDays, pts, shortDate } from '../format.ts';
import { useApi } from '../hooks.ts';
import { DUTY_ICON_SET, DutyIcon } from '../icons.tsx';
import { canPromptInstall, currentSubscription, disablePush, enablePush, isIOS, isStandalone, onInstallAvailable, promptInstall, pushSupported } from '../pwa.ts';
import { useToast } from '../toast.tsx';
import type { Absence, Duty, House, Member, VoteDuty } from '../types.ts';

const PALETTE = ['#3A43C8', '#0F766E', '#B45309', '#9D174D', '#4D7C0F', '#1D4ED8', '#7C3AED', '#475569'];

function Back({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <header className="screen-head with-back">
      <button className="back" onClick={onBack} aria-label="Back"><TbArrowLeft size={20} /></button>
      <h1>{title}</h1>
    </header>
  );
}

export function MeScreen({ me, house, go, onSignOut, onMe }: { me: Member; house: House; go: (p: string) => void; onSignOut: () => void; onMe: (m: Member) => void }) {
  const toast = useToast();
  const signOut = async () => {
    await post('/api/logout').catch(() => undefined);
    onSignOut();
  };
  const setColor = async (color: string) => {
    try {
      onMe(await patch<Member>(`/api/members/${me.id}`, { color }));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <div className="screen">
      <header className="profile">
        <Avatar name={me.name} color={me.color} size={56} />
        <div>
          <h1>{me.name}</h1>
          <p className="muted small">{me.isAdmin ? 'House admin' : 'Housemate'} · {house.name}</p>
        </div>
      </header>
      <div>
        <p className="label">Your color</p>
        <div className="swatches" role="radiogroup" aria-label="Your color">
          {PALETTE.map((c) => (
            <button key={c} role="radio" aria-checked={me.color === c} aria-label={`Color ${c}`} className={me.color === c ? 'swatch on' : 'swatch'} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>
      <div className="list-card">
        <Row icon={TbBell} label="Reminders" hint="Notifications on this phone" onClick={() => go('/me/reminders')} />
        <Row icon={TbPlaneDeparture} label="Going away" hint="Pause your duties fairly" onClick={() => go('/me/away')} />
        <Row icon={TbScale} label="Rate duty effort" hint="How heavy each duty is" onClick={() => go('/me/effort')} />
        <Row icon={TbKey} label="Change PIN" onClick={() => go('/me/pin')} />
      </div>
      {me.isAdmin && (
        <section>
          <div className="section-head"><h2>House admin</h2></div>
          <div className="list-card">
            <Row icon={TbUsers} label="People and invites" onClick={() => go('/me/members')} />
            <Row icon={TbListCheck} label="Duties" hint="Who can do what, effort, people per week" onClick={() => go('/me/duties')} />
            <Row icon={TbHome} label="House settings" hint="Name, reminder time, time zone" onClick={() => go('/me/house')} />
          </div>
        </section>
      )}
      <button className="btn btn-lg" onClick={signOut}><TbLogout size={18} aria-hidden="true" /> Sign out</button>
    </div>
  );
}

export function Reminders({ go }: { go: (p: string) => void }) {
  const toast = useToast();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [installable, setInstallable] = useState(canPromptInstall());
  useEffect(() => {
    currentSubscription().then((s) => setOn(Boolean(s)), () => setOn(false));
    return onInstallAvailable(() => setInstallable(true));
  }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      if (on) {
        await disablePush();
        setOn(false);
        toast('Reminders turned off on this phone');
      } else {
        await enablePush();
        setOn(true);
        toast('Reminders turned on');
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    try {
      const r = await post<{ status: string }>('/api/push/test');
      toast(r.status === 'sent' ? 'Sent. It should appear in a few seconds.' : 'No device received it. Turn reminders off and on, then try again.', r.status === 'sent' ? 'ok' : 'error');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const iosNeedsInstall = isIOS() && !isStandalone();
  return (
    <div className="screen">
      <Back onBack={() => go('/me')} title="Reminders" />
      {iosNeedsInstall ? (
        <div className="card stack">
          <div className="card-head"><TbDeviceMobile size={18} aria-hidden="true" /><h2>Add Rota to your Home Screen first</h2></div>
          <ol className="steps-list">
            <li>Tap the <strong>Share</strong> button in Safari's toolbar.</li>
            <li>Choose <strong>Add to Home Screen</strong>.</li>
            <li>Open Rota from your Home Screen and come back here.</li>
          </ol>
          <p className="muted small">iPhones only allow notifications for apps on the Home Screen (iOS 16.4 or newer).</p>
        </div>
      ) : !pushSupported() ? (
        <Empty icon={TbBell} title="This browser can't show notifications">Use Chrome on Android, or Safari on iPhone after adding Rota to your Home Screen.</Empty>
      ) : (
        <div className="card stack">
          <div className="toggle-row">
            <div>
              <strong>Reminders on this phone</strong>
              <p className="muted small">Trash nights, weekly duties, swaps and nudges.</p>
            </div>
            <button className={on ? 'switch on' : 'switch'} role="switch" aria-checked={Boolean(on)} aria-label="Reminders" disabled={busy || on === null} onClick={toggle}>
              <span />
            </button>
          </div>
          {on && <button className="btn" onClick={test}>Send a test reminder</button>}
        </div>
      )}
      {installable && !isStandalone() && (
        <button className="btn btn-primary btn-lg" onClick={() => promptInstall()}><TbDeviceMobile size={18} aria-hidden="true" /> Install Rota on this device</button>
      )}
      <div className="card">
        <h2>When reminders arrive</h2>
        <ul className="plain">
          <li>Your trash night, in the evening</li>
          <li>Friday evening for your weekly duty, and Sunday at noon if it's still open</li>
          <li>Monday morning: your week at a glance</li>
          <li>Right away for swaps, nudges and flags</li>
        </ul>
      </div>
    </div>
  );
}

export function Away({ me, house, go }: { me: Member; house: House; go: (p: string) => void }) {
  const toast = useToast();
  const list = useApi<{ absences: Absence[] }>('/api/absences');
  const today = new Date().toLocaleDateString('en-CA');
  const [who, setWho] = useState(me.id);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 3));
  const [note, setNote] = useState('');
  const [changes, setChanges] = useState<string[] | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await post<{ changes: string[] }>('/api/absences', { memberId: who, startDate: from, endDate: to, note });
      setChanges(r.changes);
      setNote('');
      toast('Away dates saved');
      void list.reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const remove = async (a: Absence) => {
    try {
      await api(`/api/absences/${a.id}`, { method: 'DELETE' });
      void list.reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="screen">
      <Back onBack={() => go('/me')} title="Going away" />
      <p className="muted">Your duties move to someone fair while you're gone. Whoever covers earns the points, and it evens out after you're back. Away 4 or more days means no weekly duty that week.</p>
      <form className="card stack" onSubmit={save}>
        {me.isAdmin && (
          <label className="field"><span>Who</span>
            <select className="input" value={who} onChange={(e) => setWho(Number(e.target.value))}>
              {house.members.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        )}
        <div className="two">
          <label className="field"><span>From</span><input className="input" type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} required /></label>
          <label className="field"><span>Until</span><input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} required /></label>
        </div>
        <label className="field"><span>Note (optional)</span><input className="input" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} placeholder="Visiting family" /></label>
        <button className="btn btn-primary btn-lg">Save away dates</button>
      </form>
      {changes && (
        <div className="note">
          {changes.length === 0 ? 'No planned duties needed to move.' : <span><strong>Rota updated:</strong> {changes.join('; ')}</span>}
        </div>
      )}
      <section>
        <div className="section-head"><h2>Coming up</h2></div>
        {!list.data ? <Loading /> : list.data.absences.length === 0 ? <Empty icon={TbHome} title="Everyone's home" /> : (
          <div className="list-card">
            {list.data.absences.map((a) => (
              <Row key={a.id} icon={TbPlaneDeparture} label={`${a.memberName}: ${shortDate(a.startDate)} – ${shortDate(a.endDate)}`} hint={a.note ?? undefined}
                right={(a.memberId === me.id || me.isAdmin) ? <button className="btn btn-sm" onClick={() => remove(a)}>Remove</button> : undefined} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const SCALE = ['Very light', 'Light', 'Medium', 'Heavy', 'Very heavy'];

export function Effort({ go }: { go: (p: string) => void }) {
  const toast = useToast();
  const { data, setData } = useApi<{ duties: VoteDuty[] }>('/api/votes');
  const vote = async (id: number, score: number) => {
    try {
      setData(await api<{ duties: VoteDuty[] }>(`/api/votes/${id}`, { method: 'PUT', body: { score } }));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <div className="screen">
      <Back onBack={() => go('/me')} title="Rate duty effort" />
      <p className="muted">Everyone rates each duty from 1 to 5. Its points are the house average, so heavier duties count for more. Changes apply from the next planned week.</p>
      {!data ? <Loading /> : data.duties.map((d) => (
        <div key={d.id} className="card vote">
          <div className="vote-head">
            <span className="duty-icon"><DutyIcon icon={d.icon} name={d.name} kind={d.kind} /></span>
            <strong>{d.name}</strong>
            <span className="muted small">{pts(d.points)}{d.votes ? ` · ${d.votes} vote${d.votes === 1 ? '' : 's'}` : ''}</span>
          </div>
          <div className="scale" role="radiogroup" aria-label={`Effort for ${d.name}`}>
            {SCALE.map((label, i) => (
              <button key={label} role="radio" aria-checked={d.myVote === i + 1} className={d.myVote === i + 1 ? 'on' : ''} onClick={() => vote(d.id, i + 1)}>
                <span className="scale-n">{i + 1}</span><span className="scale-label">{label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChangePin({ go, onSignOut }: { go: (p: string) => void; onSignOut: () => void }) {
  const toast = useToast();
  const [stage, setStage] = useState<'current' | 'next' | 'again'>('current');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [value, setValue] = useState('');
  const done = async (v: string) => {
    if (stage === 'current') { setCurrent(v); setStage('next'); setValue(''); return; }
    if (stage === 'next') { setNext(v); setStage('again'); setValue(''); return; }
    if (v !== next) { toast('Those PINs didn\'t match', 'error'); setStage('next'); setValue(''); return; }
    try {
      await post('/api/me/pin', { current, next });
      toast('PIN changed. Sign in with the new one.');
      onSignOut();
    } catch (e) {
      toast((e as Error).message, 'error');
      setStage('current');
      setValue('');
    }
  };
  return (
    <div className="screen">
      <Back onBack={() => go('/me')} title="Change PIN" />
      <p className="label center">{stage === 'current' ? 'Your current PIN' : stage === 'next' ? 'New PIN' : 'New PIN again'}</p>
      <PinPad value={value} onChange={setValue} onComplete={done} />
    </div>
  );
}

export function Members({ me, house, go, reloadHouse }: { me: Member; house: House; go: (p: string) => void; reloadHouse: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const share = async (m: Member) => {
    try {
      const { url } = await post<{ url: string }>(`/api/members/${m.id}/invite`);
      const text = `Hi ${m.name}, join ${house.name} on House Rota to see your duties: ${url}`;
      if (navigator.share) await navigator.share({ title: 'House Rota invite', text });
      else {
        await navigator.clipboard.writeText(text);
        toast('Invite link copied. Paste it into WhatsApp.');
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'error');
    }
  };
  const update = async (m: Member, body: Partial<Member>) => {
    try {
      await patch(`/api/members/${m.id}`, body);
      reloadHouse();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await post('/api/members', { name });
      setName('');
      reloadHouse();
      toast('Added. Send them their invite link.');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <div className="screen">
      <Back onBack={() => go('/me')} title="People and invites" />
      <p className="muted">Each person gets their own link. It lets them set a PIN, works once, and expires after 7 days.</p>
      <ul className="list-card">
        {house.members.map((m) => (
          <li key={m.id} className={`member${m.active ? '' : ' inactive'}`}>
            <Avatar name={m.name} color={m.color} size={36} />
            <div className="member-text">
              <strong>{m.name}{m.id === me.id ? ' (you)' : ''}</strong>
              <span className="muted small">{!m.active ? 'Moved out' : m.joined ? (m.isAdmin ? 'Admin' : 'Joined') : 'Invite not accepted yet'}</span>
            </div>
            {m.id !== me.id && (
              <div className="member-actions">
                {m.active && <button className="btn btn-sm" onClick={() => share(m)}><TbShare2 size={15} aria-hidden="true" /> {m.joined ? 'New link' : 'Invite'}</button>}
                <button className="btn btn-sm btn-quiet" onClick={() => update(m, { active: !m.active })}>{m.active ? 'Moved out' : 'Moved back'}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <form className="inline-form" onSubmit={add}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New housemate's name" maxLength={30} required />
        <button className="btn btn-primary"><TbPlus size={16} aria-hidden="true" /> Add</button>
      </form>
    </div>
  );
}

export function Duties({ house, go, reloadHouse }: { house: House; go: (p: string) => void; reloadHouse: () => void }) {
  const [editing, setEditing] = useState<Duty | 'new' | null>(null);
  if (editing) return <DutyEditor duty={editing === 'new' ? null : editing} house={house} onDone={() => { setEditing(null); reloadHouse(); }} onCancel={() => setEditing(null)} />;
  return (
    <div className="screen">
      <Back onBack={() => go('/me')} title="Duties" />
      <ul className="list-card">
        {house.duties.map((d) => (
          <li key={d.id}>
            <button className="row" onClick={() => setEditing(d)}>
              <span className="row-icon" aria-hidden="true"><DutyIcon icon={d.icon} name={d.name} kind={d.kind} /></span>
              <span className="row-text">
                <span className="row-label">{d.name}{d.active ? '' : ' (paused)'}</span>
                <span className="row-hint">{d.kind === 'trash' ? 'Daily rotation, everyone' : `${d.slots} ${d.slots === 1 ? 'person' : 'people'} a week · ${d.eligible ? d.eligible.map((id) => house.members.find((m) => m.id === id)?.name).join(', ') : 'everyone'}`}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button className="btn btn-lg" onClick={() => setEditing('new')}><TbPlus size={18} aria-hidden="true" /> Add a weekly duty</button>
    </div>
  );
}

function DutyEditor({ duty, house, onDone, onCancel }: { duty: Duty | null; house: House; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(duty?.name ?? '');
  const [icon, setIcon] = useState(duty && DUTY_ICON_SET[duty.icon] ? duty.icon : 'sparkles');
  const [slots, setSlots] = useState(duty?.slots ?? 1);
  const [points, setPoints] = useState(duty?.defaultPoints ?? 2);
  const [eligible, setEligible] = useState<number[]>(duty?.eligible ?? []);
  const [active, setActive] = useState(duty?.active ?? true);
  const people = house.members.filter((m) => m.active);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const body = { name, icon, slots, points, eligible: eligible.length ? eligible : null, active };
      if (duty) await patch(`/api/duties/${duty.id}`, body);
      else await post('/api/duties', body);
      toast('Saved. Changes apply from the next planned week.');
      onDone();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <div className="screen">
      <Back onBack={onCancel} title={duty ? 'Edit duty' : 'New duty'} />
      <form className="stack" onSubmit={save}>
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} required /></label>
        <div className="field"><span>Icon</span>
          <div className="icon-grid" role="radiogroup" aria-label="Icon">
            {Object.entries(DUTY_ICON_SET).map(([key, { icon: Icon, label }]) => (
              <button type="button" key={key} role="radio" aria-checked={icon === key} aria-label={label} title={label} className={icon === key ? 'icon-choice on' : 'icon-choice'} onClick={() => setIcon(key)}>
                <Icon size={20} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
        {duty?.kind !== 'trash' && (
          <div className="field"><span>People each week</span>
            <div className="stepper">
              <button type="button" className="icon-btn big" onClick={() => setSlots((s) => Math.max(1, s - 1))} aria-label="Fewer"><TbMinus size={20} /></button>
              <span className="stepper-value">{slots}</span>
              <button type="button" className="icon-btn big" onClick={() => setSlots((s) => Math.min(4, s + 1))} aria-label="More"><TbPlus size={20} /></button>
            </div>
          </div>
        )}
        <div className="field"><span>Starting effort (until people vote)</span>
          <div className="scale">
            {[1, 2, 3, 4, 5].map((p) => <button type="button" key={p} className={points === p ? 'on' : ''} aria-pressed={points === p} onClick={() => setPoints(p)}><span className="scale-n">{p}</span></button>)}
          </div>
        </div>
        {duty?.kind !== 'trash' && (
          <div className="field"><span>Who can do it (none selected means everyone)</span>
            <div className="chips">
              {people.map((m) => (
                <button type="button" key={m.id} aria-pressed={eligible.includes(m.id)} className={eligible.includes(m.id) ? 'chip on' : 'chip'}
                  onClick={() => setEligible((e) => (e.includes(m.id) ? e.filter((x) => x !== m.id) : [...e, m.id]))}>{m.name}</button>
              ))}
            </div>
          </div>
        )}
        {duty && (
          <label className="toggle-row card">
            <span><strong>Active</strong><span className="muted small"> Paused duties aren't planned.</span></span>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          </label>
        )}
        <button className="btn btn-primary btn-lg">Save</button>
      </form>
    </div>
  );
}

export function HouseSettings({ house, go, reloadHouse }: { house: House; go: (p: string) => void; reloadHouse: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(house.name);
  const [hour, setHour] = useState(house.reminderHour);
  const [tz, setTz] = useState(house.timezone);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await patch('/api/house', { name, reminderHour: hour, timezone: tz });
      reloadHouse();
      toast('Settings saved');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <div className="screen">
      <Back onBack={() => go('/me')} title="House settings" />
      <form className="stack" onSubmit={save}>
        <label className="field"><span>House name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required /></label>
        <label className="field"><span>Evening reminder time</span>
          <select className="input" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
            {Array.from({ length: 17 }, (_, i) => i + 6).map((h) => <option key={h} value={h}>{h % 12 || 12}:00 {h < 12 ? 'AM' : 'PM'}</option>)}
          </select>
        </label>
        <label className="field"><span>Time zone</span><input className="input" value={tz} onChange={(e) => setTz(e.target.value)} /></label>
        <button className="btn btn-primary btn-lg">Save</button>
      </form>
    </div>
  );
}
