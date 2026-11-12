import { useEffect, useRef, type ReactNode } from 'react';
import type { IconType } from 'react-icons';
import { TbChevronRight, TbX } from 'react-icons/tb';

export function Avatar({ name, color, size = 32 }: { name: string | null; color?: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: color ?? 'var(--faint)' }} aria-hidden="true">
      {name ? name.slice(0, 1).toUpperCase() : '?'}
    </span>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><TbX size={18} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: IconType; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={22} aria-hidden="true" />
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Loading() {
  return <div className="loading" role="status" aria-label="Loading"><span /></div>;
}

export function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Row({ icon: Icon, label, hint, onClick, right }: { icon: IconType; label: string; hint?: string; onClick?: () => void; right?: ReactNode }) {
  const body = (
    <>
      <span className="row-icon" aria-hidden="true"><Icon size={18} /></span>
      <span className="row-text">
        <span className="row-label">{label}</span>
        {hint && <span className="row-hint">{hint}</span>}
      </span>
      {right ?? (onClick && <TbChevronRight className="row-chev" size={18} aria-hidden="true" />)}
    </>
  );
  return onClick ? <button className="row" onClick={onClick}>{body}</button> : <div className="row">{body}</div>;
}
