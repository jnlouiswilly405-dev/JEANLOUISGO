import { useState } from 'react';
import { AuthGate, NotificationsPanel, useDocumentTitle, useLocalization, useSession } from '@multigo/app-shell';
import { Orders } from './pages/Orders.js';
import { Menu } from './pages/Menu.js';
import { Reviews } from './pages/Reviews.js';
import { Settlements } from './pages/Settlements.js';

const TABS = { orders: 'merchantOrders', menu: 'merchantMenu', settlements: 'settlements', reviews: 'merchantReviews', notifications: 'notifications' } as const;
type Tab = keyof typeof TABS;

function Shell() {
  const { user, logout } = useSession();
  const { t } = useLocalization();
  const [tab, setTab] = useState<Tab>('orders');
  return (
    <>
      <header>
        <strong>{t('merchantAppTitle')}</strong>
        <nav aria-label={t('main')}>
          {(Object.keys(TABS) as Tab[]).map((tab) => <button key={tab} onClick={() => setTab(tab)}>{t(TABS[tab])}</button>)}
        </nav>
        <span className="muted">{user?.displayName}</span>
        <button onClick={logout}>{t('signOut')}</button>
      </header>
      <main>
        {tab === 'orders' && <Orders />}
        {tab === 'menu' && <Menu />}
        {tab === 'settlements' && <Settlements />}
        {tab === 'reviews' && <Reviews />}
        {tab === 'notifications' && <NotificationsPanel />}
      </main>
    </>
  );
}

export function App() {
  const { t } = useLocalization();
  useDocumentTitle('merchantAppTitle');
  return <AuthGate title={t('merchantSignInTitle')}><Shell /></AuthGate>;
}
