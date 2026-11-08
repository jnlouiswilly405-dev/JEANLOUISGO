import { useState, type FormEvent, type ReactNode } from 'react';
import { useSession } from './session.js';

export function ErrorBanner({ message }: { message: string | null }) {
  return message ? <p role="alert" className="error">{message}</p> : null;
}

export function LoginForm({ title }: { title: string }) {
  const { login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await login(email, password); }
    catch (err) { setError(err instanceof Error ? err.message : 'Sign-in failed'); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} aria-label="Sign in">
      <h1>{title}</h1>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="current-password" /></label>
      <ErrorBanner message={error} />
      <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}

/** Shows the login form until a permitted user is signed in, then renders the app. */
export function AuthGate({ title, children }: { title: string; children: ReactNode }) {
  const { user, restoring } = useSession();
  if (restoring) return <p role="status">Loading…</p>;
  if (!user) return <LoginForm title={title} />;
  return <>{children}</>;
}
