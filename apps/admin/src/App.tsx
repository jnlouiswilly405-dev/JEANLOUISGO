import { useState } from 'react';
import { AuthGate, useDocumentTitle, useLocalization, useSession } from '@multigo/app-shell';
import { Overview } from './pages/Overview.js';
import { BlockedOutbox } from './pages/BlockedOutbox.js';
import { Unreferenced } from './pages/Unreferenced.js';
import { Promotions } from './pages/Promotions.js';

const TABS = { overview: 'adminOverview', outbox: 'blockedOutbox', payments: 'unreferencedPayments', promos: 'promotions' } as const;
type Tab = keyof typeof TABS;

function Shell() {
  const { user, logout } = useSession();
  const { t } = useLocalization();
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <>
      <header>
        <strong>{t('adminAppTitle')}</strong>
        <nav aria-label={t('main')}>
          {(Object.keys(TABS) as Tab[]).map((tab) => <button key={tab} onClick={() => setTab(tab)}>{t(TABS[tab])}</button>)}
        </nav>
        <span className="muted">{user?.displayName}</span>
        <button onClick={logout}>{t('signOut')}</button>
      </header>
      <main>
        <p className="banner">{t('financialWarning')}</p>
        {tab === 'overview' && <Overview />}
        {tab === 'outbox' && <BlockedOutbox />}
        {tab === 'payments' && <Unreferenced />}
        {tab === 'promos' && <Promotions />}
      </main>
    </>
  );
}

export function App() {
  const { t } = useLocalization();
  useDocumentTitle('adminAppTitle');
  return <AuthGate title={t('adminSignInTitle')}><Shell /></AuthGate>;
}
