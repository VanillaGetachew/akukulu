'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { AuthResponse, ClientToServerEvents, ServerToClientEvents, UserProfile } from '@akukulu/shared';
import { API_URL, DEV_AUTH, api, setApiToken, storeToken, storedToken } from './api';
import { initTelegram, startParam, webApp } from './telegram';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

type Status = 'loading' | 'ready' | 'needs-login' | 'error';

interface SessionValue {
  status: Status;
  error: string | null;
  user: UserProfile | null;
  socket: GameSocket | null;
  connected: boolean;
  /** Start parameter from the Telegram deep link (e.g. room_ABC123). */
  launchParam: string | null;
  refreshUser(): Promise<void>;
  devLogin(name: string): Promise<void>;
  logout(): void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [socket, setSocket] = useState<GameSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [launchParam, setLaunchParam] = useState<string | null>(null);
  const started = useRef(false);

  const adopt = useCallback((res: AuthResponse, persist: boolean) => {
    setApiToken(res.token);
    storeToken(res.token, persist);
    setToken(res.token);
    setUser(res.user);
    setStatus('ready');
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    initTelegram();
    setLaunchParam(startParam());
    (async () => {
      try {
        const tg = webApp();
        if (tg) {
          adopt(await api<AuthResponse>('/auth/telegram', { body: { initData: tg.initData } }), false);
          return;
        }
        const saved = storedToken();
        if (saved) {
          setApiToken(saved);
          try {
            const me = await api<UserProfile>('/me');
            adopt({ token: saved, user: me }, true);
            return;
          } catch {
            storeToken(null, false);
            setApiToken(null);
          }
        }
        setStatus(DEV_AUTH ? 'needs-login' : 'error');
        if (!DEV_AUTH) setError('Open Akukulu from Telegram to play.');
      } catch (err) {
        setError((err as Error).message);
        setStatus('error');
      }
    })();
  }, [adopt]);

  useEffect(() => {
    if (!token) return;
    const s: GameSocket = io(API_URL, { auth: { token }, transports: ['websocket', 'polling'] });
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('balance:update', ({ balance }) => setUser((u) => (u ? { ...u, balance } : u)));
    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, [token]);

  const refreshUser = useCallback(async () => {
    setUser(await api<UserProfile>('/me'));
  }, []);

  const devLogin = useCallback(
    async (name: string) => {
      adopt(await api<AuthResponse>('/auth/dev', { body: { name } }), true);
    },
    [adopt],
  );

  const logout = useCallback(() => {
    storeToken(null, false);
    setApiToken(null);
    setToken(null);
    setUser(null);
    setStatus(DEV_AUTH ? 'needs-login' : 'error');
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ status, error, user, socket, connected, launchParam, refreshUser, devLogin, logout }),
    [status, error, user, socket, connected, launchParam, refreshUser, devLogin, logout],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
