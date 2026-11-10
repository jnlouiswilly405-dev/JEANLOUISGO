import { useState } from 'react';
import { AuthGate, NotificationsPanel, useDocumentTitle, useLocalization, useSession } from '@multigo/app-shell';
import type { Merchant } from '@multigo/api-client';
import { MerchantList } from './pages/MerchantList.js';
import { Menu } from './pages/Menu.js';
import { OrderList } from './pages/OrderList.js';
import { OrderDetail } from './pages/OrderDetail.js';

type View = { name: 'merchants' } | { name: 'menu'; merchant: Merchant } | { name: 'orders' } | { name: 'order'; id: string } | { name: 'notifications' };

function Shell() {
  const { user, logout } = useSession();
  const { t } = useLocalization();
  const [view, setView] = useState<View>({ name: 'merchants' });
  return (
    <>
      <header>
        <strong>MULTIGO</strong>
        <nav aria-label={t('main')}>
          <button onClick={() => setView({ name: 'merchants' })}>{t('restaurants')}</button>
          <button onClick={() => setView({ name: 'orders' })}>{t('myOrders')}</button>
          <button onClick={() => setView({ name: 'notifications' })}>{t('notifications')}</button>
        </nav>
        <span className="muted">{user?.displayName}</span>
        <button onClick={logout}>{t('signOut')}</button>
      </header>
      <main>
        {view.name === 'merchants' && <MerchantList onOpen={(merchant) => setView({ name: 'menu', merchant })} />}
        {view.name === 'menu' && <Menu merchant={view.merchant} onOrdered={(id) => setView({ name: 'order', id })} />}
        {view.name === 'orders' && <OrderList onOpen={(id) => setView({ name: 'order', id })} />}
        {view.name === 'order' && <OrderDetail id={view.id} />}
        {view.name === 'notifications' && <NotificationsPanel />}
      </main>
    </>
  );
}

export function App() {
  const { t } = useLocalization();
  useDocumentTitle('customerAppTitle');
  return <AuthGate title={t('customerSignInTitle')}><Shell /></AuthGate>;
}
