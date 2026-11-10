import { useState, type FormEvent, type ReactNode } from 'react';
import { useSession } from './session.js';
import { LanguageSelector, useLocalization } from './localization.js';

export function ErrorBanner({ message }: { message: string | null }) {
  return message ? <p role="alert" className="error">{message}</p> : null;
}

export function LoginForm({ title }: { title: string }) {
  const { login } = useSession();
  const { t } = useLocalization();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await login(email, password); }
    catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(message === 'This account cannot use this application' ? t('accountCannotUseApp') : message || t('signInFailed'));
    }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} aria-label={t('signInAria')}>
      <h1>{title}</h1>
      <label>{t('email')}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></label>
      <label>{t('password')}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="current-password" /></label>
      <ErrorBanner message={error} />
      <button type="submit" disabled={busy}>{busy ? t('signingIn') : t('signIn')}</button>
    </form>
  );
}

/** Shows the login form until a permitted user is signed in, then renders the app. */
export function AuthGate({ title, children }: { title: string; children: ReactNode }) {
  const { user, restoring } = useSession();
  const { t } = useLocalization();
  return (
    <>
      <LanguageSelector />
      {restoring ? <p role="status">{t('loading')}</p> : !user ? <LoginForm title={title} /> : children}
    </>
  );
}
