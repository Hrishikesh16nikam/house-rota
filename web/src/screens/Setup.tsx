import { useState } from 'react';
import { TbMinus, TbPlus, TbX } from 'react-icons/tb';
import { post } from '../api.ts';
import { PinPad } from '../components/PinPad.tsx';
import type { Member } from '../types.ts';

const STEPS = ['House', 'You', 'Housemates', 'Washrooms', 'Kitchen'] as const;

export function Setup({ onIn }: { onIn: (m: Member) => void }) {
  const [step, setStep] = useState(0);
  const [code, setCode] = useState('');
  const [houseName, setHouseName] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [adminName, setAdminName] = useState('');
  const [pin, setPin] = useState('');
  const [mates, setMates] = useState<string[]>(['']);
  const [washrooms, setWashrooms] = useState<{ name: string; members: string[] }[]>([{ name: 'Washroom 1', members: [] }]);
  const [kitchen, setKitchen] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const people = [adminName.trim(), ...mates.map((m) => m.trim())].filter(Boolean);
  const valid = [
    code.trim().length > 0 && houseName.trim().length > 0,
    adminName.trim().length > 0 && pin.length === 6,
    people.length >= 2 && new Set(people.map((p) => p.toLowerCase())).size === people.length,
    washrooms.every((w) => w.name.trim() && w.members.length > 0),
    true,
  ];

  const toggle = (wi: number, name: string) =>
    setWashrooms((ws) => ws.map((w, i) => (i !== wi ? w : { ...w, members: w.members.includes(name) ? w.members.filter((n) => n !== name) : [...w.members, name] })));

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ member: Member }>('/api/setup', {
        setupCode: code.trim(), houseName, timezone, adminName: adminName.trim(), adminPin: pin,
        housemates: mates.map((m) => m.trim()).filter(Boolean), washrooms, kitchenSlots: kitchen,
      });
      window.history.replaceState(null, '', '/me/members');
      onIn(r.member);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="setup">
      <header className="setup-head">
        <img src="/icons/icon.svg" alt="" className="logo small" />
        <div className="steps" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => <span key={s} className={i <= step ? 'on' : ''} />)}
        </div>
      </header>

      <section className="setup-body">
        {step === 0 && (
          <>
            <h1>Set up your house</h1>
            <label className="field">
              <span>Setup code</span>
              <input className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" placeholder="From npm run secrets" />
            </label>
            <label className="field">
              <span>House name</span>
              <input className="input" value={houseName} onChange={(e) => setHouseName(e.target.value)} placeholder="Maple Street House" maxLength={40} />
            </label>
            <label className="field">
              <span>Time zone</span>
              <input className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </label>
          </>
        )}
        {step === 1 && (
          <>
            <h1>And you are?</h1>
            <p className="muted">You'll be the house admin: you invite people and settle disputes.</p>
            <label className="field">
              <span>Your name</span>
              <input className="input" value={adminName} onChange={(e) => setAdminName(e.target.value)} maxLength={30} autoFocus />
            </label>
            <p className="label">Choose your 6-digit PIN</p>
            <PinPad value={pin} onChange={setPin} />
          </>
        )}
        {step === 2 && (
          <>
            <h1>Who else lives here?</h1>
            <p className="muted">You'll send each person an invite link at the end.</p>
            <div className="stack-sm">
              {mates.map((m, i) => (
                <div className="mate-row" key={i}>
                  <input className="input" value={m} placeholder={`Housemate ${i + 1}`} maxLength={30}
                    onChange={(e) => setMates((ms) => ms.map((x, j) => (j === i ? e.target.value : x)))} />
                  {mates.length > 1 && <button className="icon-btn" onClick={() => setMates((ms) => ms.filter((_, j) => j !== i))} aria-label="Remove"><TbX size={16} /></button>}
                </div>
              ))}
              <button className="btn" onClick={() => setMates((ms) => [...ms, ''])}><TbPlus size={16} aria-hidden="true" /> Add someone</button>
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h1>Washrooms</h1>
            <p className="muted">Each washroom is only ever cleaned by the people who use it.</p>
            {washrooms.map((w, i) => (
              <div className="card stack-sm" key={i}>
                <div className="mate-row">
                  <input className="input" value={w.name} onChange={(e) => setWashrooms((ws) => ws.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  {washrooms.length > 1 && <button className="icon-btn" onClick={() => setWashrooms((ws) => ws.filter((_, j) => j !== i))} aria-label="Remove washroom"><TbX size={16} /></button>}
                </div>
                <p className="label">Who uses it?</p>
                <div className="chips">
                  {people.map((p) => (
                    <button key={p} className={w.members.includes(p) ? 'chip on' : 'chip'} aria-pressed={w.members.includes(p)} onClick={() => toggle(i, p)}>{p}</button>
                  ))}
                </div>
              </div>
            ))}
            <button className="btn" onClick={() => setWashrooms((ws) => [...ws, { name: `Washroom ${ws.length + 1}`, members: [] }])}><TbPlus size={16} aria-hidden="true" /> Add a washroom</button>
          </>
        )}
        {step === 4 && (
          <>
            <h1>Kitchen</h1>
            <p className="muted">How many people clean the kitchen each week? They'll always be different people.</p>
            <div className="stepper">
              <button className="icon-btn big" onClick={() => setKitchen((k) => Math.max(1, k - 1))} aria-label="Fewer"><TbMinus size={20} /></button>
              <span className="stepper-value">{kitchen}</span>
              <button className="icon-btn big" onClick={() => setKitchen((k) => Math.min(4, k + 1))} aria-label="More"><TbPlus size={20} /></button>
            </div>
            <p className="muted small">Living room (weekly) and trash (daily rotation) are added too. You can edit all duties later.</p>
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <footer className="setup-foot">
        {step > 0 && <button className="btn" onClick={() => setStep((s) => s - 1)}>Back</button>}
        {step < STEPS.length - 1 ? (
          <button className="btn btn-primary btn-lg" disabled={!valid[step]} onClick={() => setStep((s) => s + 1)}>Continue</button>
        ) : (
          <button className="btn btn-primary btn-lg" disabled={busy} onClick={finish}>{busy ? 'Creating…' : 'Create house'}</button>
        )}
      </footer>
    </main>
  );
}
