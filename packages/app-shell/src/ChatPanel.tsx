import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { ChatMessage } from '@multigo/api-client';
import { ErrorBanner } from './components.js';
import { useSession } from './session.js';

const POLL_MS = 5_000;

function describe(e: unknown): string {
  const text = e instanceof Error ? e.message : '';
  if (text.includes('CHAT_NOT_AVAILABLE')) return 'Chat opens once the order is paid.';
  if (text.includes('THREAD_CLOSED')) return 'This conversation is closed.';
  if (text.includes('ORDER_NOT_FOUND') || text.includes('NOT_A_PARTICIPANT')) return 'You cannot access this conversation.';
  return 'Chat is unavailable right now.';
}

/** Order chat between the order's customer, merchant and driver. Messages render as text only (React escapes them). */
export function ChatPanel({ orderId }: { orderId: string }) {
  const { client, user } = useSession();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (id: string) => {
    try { setMessages(await client.chat.list(id)); setError(null); } catch (e) { setError(describe(e)); }
  }, [client]);

  useEffect(() => {
    let live = true;
    setThreadId(null);
    setMessages([]);
    client.chat.openOrderThread(orderId)
      .then((t) => { if (live) { setThreadId(t.id); void load(t.id); } })
      .catch((e) => { if (live) setError(describe(e)); });
    return () => { live = false; };
  }, [client, orderId, load]);

  useEffect(() => {
    if (!threadId) return;
    const t = setInterval(() => void load(threadId), POLL_MS);
    return () => clearInterval(t);
  }, [threadId, load]);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const body = text.trim();
    if (!threadId || !body) return;
    setBusy(true);
    try {
      await client.chat.send(threadId, body);
      setText('');
      await load(threadId);
    } catch (e) { setError(describe(e)); } finally { setBusy(false); }
  }

  return (
    <section aria-label="Order chat">
      <h3>Chat</h3>
      <ErrorBanner message={error} />
      {threadId && messages.length === 0 && !error && <p className="muted">No messages yet.</p>}
      <ul>
        {messages.map((m) => (
          <li key={m.id}>
            <strong>{m.sender_id === user?.id ? 'You' : 'Them'}</strong>: {m.body}{' '}
            <span className="muted">{new Date(m.created_at).toLocaleTimeString()}</span>
          </li>
        ))}
      </ul>
      {threadId && (
        <form onSubmit={submit}>
          <label>
            Message
            <input value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
          </label>
          <button type="submit" disabled={busy || !text.trim()}>Send</button>
        </form>
      )}
    </section>
  );
}

/** Opens the chat only on demand, so merely viewing an order never creates a thread. */
export function ChatToggle({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  return open
    ? <ChatPanel orderId={orderId} />
    : <button type="button" onClick={() => setOpen(true)}>Open chat</button>;
}
