import { useState } from 'react';
import { AuthGate, useSession } from '@multigo/app-shell';
import { Overview } from './pages/Overview.js';
import { BlockedOutbox } from './pages/BlockedOutbox.js';
import { Unreferenced } from './pages/Unreferenced.js';
import { Promotions } from './pages/Promotions.js';

const TABS = { overview: 'Overview', outbox: 'Blocked outbox', payments: 'Unreferenced payments', promos: 'Promotions' } as const;
type Tab = keyof typeof TABS;

function Shell() {
  const { user, logout } = useSession();
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <>
      <header>
        <strong>MULTIGO Admin</strong>
        <nav aria-label="Main">
          {(Object.keys(TABS) as Tab[]).map((t) => <button key={t} onClick={() => setTab(t)}>{TABS[t]}</button>)}
        </nav>
        <span className="muted">{user?.displayName}</span>
        <button onClick={logout}>Sign out</button>
      </header>
      <main>
        <p className="banner">Financial views are read-only; promotion management is the only write action. Settlement, payouts, refunds and Connect are disabled in this build.</p>
        {tab === 'overview' && <Overview />}
        {tab === 'outbox' && <BlockedOutbox />}
        {tab === 'payments' && <Unreferenced />}
        {tab === 'promos' && <Promotions />}
      </main>
    </>
  );
}

export function App() {
  return <AuthGate title="MULTIGO Admin — Sign in"><Shell /></AuthGate>;
}
