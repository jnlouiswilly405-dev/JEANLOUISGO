import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createApiClient, type ApiClient, type User, type UserRole } from '@multigo/api-client';
import { LocalizationProvider } from './localization.js';

const STORAGE_KEY = 'multigo.session';

export interface Session {
  user: User | null;
  /** true while a stored token is being validated on startup */
  restoring: boolean;
  client: ApiClient;
  login(email: string, password: string): Promise<void>;
  logout(): void;
}

const SessionContext = createContext<Session | null>(null);

export interface SessionProviderProps {
  apiBaseUrl: string;
  /** Roles this app serves. Other roles are signed straight back out. */
  allowedRoles: readonly UserRole[];
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  fetchImpl?: typeof fetch;
  children: ReactNode;
}

/**
 * Keeps the bearer token in memory and mirrors it to sessionStorage so a reload survives; it is cleared on
 * logout or any 401. The backend has no refresh endpoint, so an expired token means signing in again.
 */
export function SessionProvider({ apiBaseUrl, allowedRoles, storage, fetchImpl, children }: SessionProviderProps) {
  const store = storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
  const tokenRef = useRef<string | null>(store?.getItem(STORAGE_KEY) ?? null);
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState<boolean>(tokenRef.current !== null);

  const clear = useCallback(() => {
    tokenRef.current = null;
    store?.removeItem(STORAGE_KEY);
    setUser(null);
  }, [store]);

  const client = useMemo(
    () => createApiClient({ baseUrl: apiBaseUrl, getToken: () => tokenRef.current, onUnauthorized: clear, fetchImpl }),
    [apiBaseUrl, clear, fetchImpl],
  );

  const roles = allowedRoles.join(',');
  useEffect(() => {
    if (!tokenRef.current) return;
    let cancelled = false;
    client.auth.me()
      .then(({ user: me }) => { if (!cancelled) { if (roles.split(',').includes(me.role)) setUser(me); else clear(); } })
      .catch(() => { if (!cancelled) clear(); })
      .finally(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; };
  }, [client, clear, roles]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await client.auth.login(email, password);
    if (!roles.split(',').includes(result.user.role)) throw new Error('This account cannot use this application');
    tokenRef.current = result.token;
    store?.setItem(STORAGE_KEY, result.token);
    setUser(result.user);
  }, [client, roles, store]);

  const value = useMemo<Session>(() => ({ user, restoring, client, login, logout: clear }), [user, restoring, client, login, clear]);
  return (
    <LocalizationProvider>
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    </LocalizationProvider>
  );
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside <SessionProvider>');
  return s;
}
