import { useEffect, useState } from 'react';
import { ErrorBanner } from './components.js';
import { useAsync } from './useAsync.js';
import { useSession } from './session.js';

const POLL_MS = 30_000;

/** Lists the signed-in user's notifications (GET /api/notifications) and lets them mark each as read. */
export function NotificationsPanel() {
  const { client } = useSession();
  const list = useAsync(() => client.notifications.list(), [client]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { reload } = list;

  useEffect(() => {
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  async function markRead(id: string) {
    setBusyId(id);
    setActionError(null);
    try { await client.notifications.markRead(id); reload(); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Could not update the notification'); }
    finally { setBusyId(null); }
  }

  const items = list.data ?? [];
  return (
    <section aria-label="Notifications">
      <h2>Notifications</h2>
      {list.loading && !list.data && <p role="status">Loading…</p>}
      <ErrorBanner message={list.error ?? actionError} />
      {list.data && items.length === 0 && <p className="muted">No notifications.</p>}
      <ul>
        {items.map((n) => (
          <li key={n.id}>
            <span>
              <strong>{n.title}</strong>{n.read_at ? '' : ' (new)'}<br />
              {n.body}<br />
              <span className="muted">{new Date(n.created_at).toLocaleString()}</span>
            </span>
            {!n.read_at && <button disabled={busyId === n.id} onClick={() => markRead(n.id)}>Mark read</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
