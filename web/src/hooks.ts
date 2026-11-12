import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.ts';

/** Fetch JSON from the API; refreshes when the app comes back into view. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ticket = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const mine = ++ticket.current;
    try {
      const r = await api<T>(path);
      if (mine === ticket.current) {
        setData(r);
        setError(null);
      }
    } catch (e) {
      if (mine === ticket.current) setError((e as Error).message);
    }
  }, [path]);

  useEffect(() => {
    void reload();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  return { data, error, reload, setData };
}

/** Minimal client-side routing on the History API. */
export function usePath(): [string, (to: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((to: string) => {
    if (to !== window.location.pathname) window.history.pushState(null, '', to);
    setPath(to);
    window.scrollTo({ top: 0 });
  }, []);
  return [path, go];
}
