import { useState } from 'react';
import { AuthGate, NotificationsPanel, useSession } from '@multigo/app-shell';
import { Orders } from './pages/Orders.js';
import { Menu } from './pages/Menu.js';
import { Reviews } from './pages/Reviews.js';
import { Settlements } from './pages/Settlements.js';

const TABS = { orders: 'Orders', menu: 'Menu', settlements: 'Settlements', reviews: 'Reviews', notifications: 'Notifications' } as const;
type Tab = keyof typeof TABS;

function Shell() {
  const { user, logout } = useSession();
  const [tab, setTab] = useState<Tab>('orders');
  return (
    <>
      <header>
        <strong>MULTIGO Merchant</strong>
        <nav aria-label="Main">
          {(Object.keys(TABS) as Tab[]).map((t) => <button key={t} onClick={() => setTab(t)}>{TABS[t]}</button>)}
        </nav>
        <span className="muted">{user?.displayName}</span>
        <button onClick={logout}>Sign out</button>
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
  return <AuthGate title="MULTIGO Merchant — Sign in"><Shell /></AuthGate>;
}
