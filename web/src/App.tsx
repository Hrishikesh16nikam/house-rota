import { useEffect, useState } from 'react';
import { TbActivity, TbCalendarWeek, TbHome, TbUserCircle } from 'react-icons/tb';
import { api, onSignedOut } from './api.ts';
import { Loading } from './components/ui.tsx';
import { useApi, usePath } from './hooks.ts';
import { Activity } from './screens/Activity.tsx';
import { Join, Login } from './screens/Auth.tsx';
import { Home } from './screens/Home.tsx';
import { HouseScreen } from './screens/HouseScreen.tsx';
import { Away, ChangePin, Duties, Effort, HouseSettings, MeScreen, Members, Reminders } from './screens/Me.tsx';
import { Setup } from './screens/Setup.tsx';
import { ToastProvider } from './toast.tsx';
import type { House, Member } from './types.ts';

export function App() {
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  );
}

function Root() {
  const [path, go] = usePath();
  const [status, setStatus] = useState<{ setUp: boolean } | null>(null);
  const [me, setMe] = useState<Member | null | undefined>(undefined);

  useEffect(() => {
    api<{ setUp: boolean }>('/api/status').then(setStatus, () => setStatus({ setUp: true }));
    api<{ member: Member }>('/api/me').then((r) => setMe(r.member), () => setMe(null));
    return onSignedOut(() => setMe(null));
  }, []);

  const join = /^\/join\/([^/]+)$/.exec(path);
  if (join) return <Join token={decodeURIComponent(join[1])} onIn={(m) => { setMe(m); go('/'); }} />;
  if (!status || me === undefined) return <div className="boot"><Loading /></div>;
  if (!status.setUp) return <Setup onIn={(m) => { setStatus({ setUp: true }); setMe(m); go('/me/members'); }} />;
  if (!me) return <Login onIn={(m) => { setMe(m); go('/'); }} />;
  return <Shell me={me} setMe={setMe} path={path} go={go} />;
}

const TABS = [
  { path: '/', icon: TbHome, label: 'Home' },
  { path: '/house', icon: TbCalendarWeek, label: 'House' },
  { path: '/activity', icon: TbActivity, label: 'Activity' },
  { path: '/me', icon: TbUserCircle, label: 'Me' },
];

function Shell({ me, setMe, path, go }: { me: Member; setMe: (m: Member | null) => void; path: string; go: (p: string) => void }) {
  const house = useApi<House>('/api/house');
  const tab = path === '/' ? '/' : TABS.find((t) => t.path !== '/' && path.startsWith(t.path))?.path ?? '/';
  const signOut = () => setMe(null);
  const reloadHouse = () => void house.reload();

  let screen;
  if (!house.data) screen = <Loading />;
  else {
    const h = house.data;
    switch (path) {
      case '/house': screen = <HouseScreen me={me} house={h} />; break;
      case '/activity': screen = <Activity />; break;
      case '/me': screen = <MeScreen me={me} house={h} go={go} onSignOut={signOut} onMe={setMe} />; break;
      case '/me/reminders': screen = <Reminders go={go} />; break;
      case '/me/away': screen = <Away me={me} house={h} go={go} />; break;
      case '/me/effort': screen = <Effort go={go} />; break;
      case '/me/pin': screen = <ChangePin go={go} onSignOut={signOut} />; break;
      case '/me/members': screen = me.isAdmin ? <Members me={me} house={h} go={go} reloadHouse={reloadHouse} /> : null; break;
      case '/me/duties': screen = me.isAdmin ? <Duties house={h} go={go} reloadHouse={reloadHouse} /> : null; break;
      case '/me/house': screen = me.isAdmin ? <HouseSettings house={h} go={go} reloadHouse={reloadHouse} /> : null; break;
      default: screen = <Home me={me} house={h} go={go} />;
    }
  }

  return (
    <div className="app">
      <main className="main">{screen}</main>
      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <button key={t.path} className={tab === t.path ? 'tab on' : 'tab'} aria-current={tab === t.path ? 'page' : undefined} onClick={() => go(t.path)}>
            <t.icon className="tab-icon" size={22} aria-hidden="true" />
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
