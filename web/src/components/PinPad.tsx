import { useEffect } from 'react';
import { TbBackspace } from 'react-icons/tb';

/** A numeric keypad for 6-digit PINs. */
export function PinPad({ value, onChange, onComplete, disabled }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean }) {
  const press = (d: string) => {
    if (disabled || value.length >= 6) return;
    const next = value + d;
    onChange(next);
    if (next.length === 6) onComplete?.(next);
  };
  const back = () => {
    if (!disabled) onChange(value.slice(0, -1));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="pin">
      <div className="pin-dots" role="img" aria-label={`${value.length} of 6 digits entered`}>
        {Array.from({ length: 6 }, (_, i) => <span key={i} className={i < value.length ? 'filled' : ''} />)}
      </div>
      <div className="pin-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => press(d)} disabled={disabled}>{d}</button>
        ))}
        <span />
        <button type="button" onClick={() => press('0')} disabled={disabled}>0</button>
        <button type="button" onClick={back} disabled={disabled} aria-label="Delete"><TbBackspace size={22} /></button>
      </div>
    </div>
  );
}
