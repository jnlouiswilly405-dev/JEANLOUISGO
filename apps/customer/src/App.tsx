import { useState } from 'react';
import { AuthGate, useSession } from '@multigo/app-shell';
import type { Merchant } from '@multigo/api-client';
import { MerchantList } from './pages/MerchantList.js';
import { Menu } from './pages/Menu.js';
import { OrderList } from './pages/OrderList.js';
import { OrderDetail } from './pages/OrderDetail.js';

type View = { name: 'merchants' } | { name: 'menu'; merchant: Merchant } | { name: 'orders' } | { name: 'order'; id: string };

function Shell() {
  const { user, logout } = useSession();
  const [view, setView] = useState<View>({ name: 'merchants' });
  return (
    <>
      <header>
        <strong>MULTIGO</strong>
        <nav aria-label="Main">
          <button onClick={() => setView({ name: 'merchants' })}>Restaurants</button>
          <button onClick={() => setView({ name: 'orders' })}>My orders</button>
        </nav>
        <span className="muted">{user?.displayName}</span>
        <button onClick={logout}>Sign out</button>
      </header>
      <main>
        {view.name === 'merchants' && <MerchantList onOpen={(merchant) => setView({ name: 'menu', merchant })} />}
        {view.name === 'menu' && <Menu merchant={view.merchant} onOrdered={(id) => setView({ name: 'order', id })} />}
        {view.name === 'orders' && <OrderList onOpen={(id) => setView({ name: 'order', id })} />}
        {view.name === 'order' && <OrderDetail id={view.id} />}
      </main>
    </>
  );
}

export function App() {
  return <AuthGate title="MULTIGO — Sign in"><Shell /></AuthGate>;
}
