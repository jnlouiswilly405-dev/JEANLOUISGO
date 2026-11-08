import { useState } from 'react';
import { AuthGate, useSession } from '@multigo/app-shell';
import { Orders } from './pages/Orders.js';
import { Menu } from './pages/Menu.js';

function Shell() {
  const { user, logout } = useSession();
  const [tab, setTab] = useState<'orders' | 'menu'>('orders');
  return (
    <>
      <header>
        <strong>MULTIGO Merchant</strong>
        <nav aria-label="Main">
          <button onClick={() => setTab('orders')}>Orders</button>
          <button onClick={() => setTab('menu')}>Menu</button>
        </nav>
        <span className="muted">{user?.displayName}</span>
        <button onClick={logout}>Sign out</button>
      </header>
      <main>{tab === 'orders' ? <Orders /> : <Menu />}</main>
    </>
  );
}

export function App() {
  return <AuthGate title="MULTIGO Merchant — Sign in"><Shell /></AuthGate>;
}
