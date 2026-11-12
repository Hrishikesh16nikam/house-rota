import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { TbAlertTriangle, TbCircleCheck } from 'react-icons/tb';

type Kind = 'ok' | 'error' | 'party';
const Ctx = createContext<(text: string, kind?: Kind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; text: string; kind: Kind }[]>([]);
  const show = useCallback((text: string, kind: Kind = 'ok') => {
    const id = Math.random();
    setItems((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.kind === 'error' ? ' toast-error' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            {t.kind === 'error' ? <TbAlertTriangle size={18} aria-hidden="true" /> : <TbCircleCheck size={18} aria-hidden="true" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
