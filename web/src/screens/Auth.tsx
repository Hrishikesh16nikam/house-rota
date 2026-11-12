import { useEffect, useState } from 'react';
import { TbAlertTriangle } from 'react-icons/tb';
import { api, post } from '../api.ts';
import { Avatar, Loading } from '../components/ui.tsx';
import { PinPad } from '../components/PinPad.tsx';
import type { Member } from '../types.ts';

function Logo() {
  return <img src="/icons/icon.svg" alt="" className="logo" />;
}

export function Login({ onIn }: { onIn: (m: Member) => void }) {
  const [opts, setOpts] = useState<{ house: string; members: { id: number; name: string; color: string }[] } | null>(null);
  const [who, setWho] = useState<{ id: number; name: string; color: string } | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<typeof opts>('/api/login-options').then(setOpts, (e) => setError((e as Error).message));
  }, []);

  const submit = async (value: string) => {
    if (!who) return;
    setBusy(true);
    setError(null);
    try {
      onIn((await post<{ member: Member }>('/api/login', { memberId: who.id, pin: value })).member);
    } catch (e) {
      setError((e as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  if (!opts) return <main className="auth">{error ? <p className="error">{error}</p> : <Loading />}</main>;
  return (
    <main className="auth">
      <div className="auth-card">
        <Logo />
        {!who ? (
          <>
            <h1>{opts.house}</h1>
            <p className="muted">Choose your name</p>
            <ul className="list-card who-list">
              {opts.members.map((m) => (
                <li key={m.id}>
                  <button className="who" onClick={() => setWho(m)}>
                    <Avatar name={m.name} color={m.color} size={32} />
                    <span>{m.name}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="muted small">Not listed? Ask your house admin for an invite link.</p>
          </>
        ) : (
          <>
            <Avatar name={who.name} color={who.color} size={52} />
            <h1>{who.name}</h1>
            <p className="muted">Enter your PIN</p>
            <PinPad value={pin} onChange={setPin} onComplete={submit} disabled={busy} />
            {error && <p className="error" role="alert"><TbAlertTriangle size={16} aria-hidden="true" /> {error}</p>}
            <button className="link" onClick={() => { setWho(null); setPin(''); setError(null); }}>Not you?</button>
          </>
        )}
      </div>
    </main>
  );
}

/** A housemate opening their invite link chooses a PIN. */
export function Join({ token, onIn }: { token: string; onIn: (m: Member) => void }) {
  const [info, setInfo] = useState<{ name: string; house: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');

  useEffect(() => {
    api<{ name: string; house: string }>(`/api/invites/${encodeURIComponent(token)}`).then(setInfo, (e) => setError((e as Error).message));
  }, [token]);

  const complete = async (value: string) => {
    if (first === null) {
      setFirst(value);
      setPin('');
      return;
    }
    if (value !== first) {
      setError('Those PINs didn\'t match. Try again.');
      setFirst(null);
      setPin('');
      return;
    }
    try {
      const r = await post<{ member: Member }>(`/api/invites/${encodeURIComponent(token)}`, { pin: value });
      window.history.replaceState(null, '', '/');
      onIn(r.member);
    } catch (e) {
      setError((e as Error).message);
      setFirst(null);
      setPin('');
    }
  };

  if (!info) return <main className="auth">{error ? <div className="auth-card"><Logo /><p className="error">{error}</p></div> : <Loading />}</main>;
  return (
    <main className="auth">
      <div className="auth-card">
        <Logo />
        <h1>Welcome, {info.name}</h1>
        <p className="muted">You've been invited to <strong>{info.house}</strong>.</p>
        <p className="label">{first === null ? 'Choose a 6-digit PIN' : 'Enter it once more'}</p>
        <PinPad value={pin} onChange={(v) => { setPin(v); setError(null); }} onComplete={complete} />
        {error && <p className="error" role="alert"><TbAlertTriangle size={16} aria-hidden="true" /> {error}</p>}
        <p className="muted small">Avoid easy ones like 123456 or a birthday.</p>
      </div>
    </main>
  );
}
