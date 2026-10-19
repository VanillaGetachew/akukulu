'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SessionProvider, useSession } from '@/lib/session';
import { LogoMark } from '@/components/art';
import { LoadingState } from '@/components/ui';

function Gate({ children }: { children: ReactNode }) {
  const { status, error, launchParam, devLogin } = useSession();
  const router = useRouter();
  const routed = useRef(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Deep links: t.me/<bot>/<app>?startapp=room_ABC123 opens that room.
  useEffect(() => {
    if (status !== 'ready' || routed.current || !launchParam) return;
    routed.current = true;
    const room = /^room_([A-Z0-9]{4,8})$/i.exec(launchParam);
    if (room) router.push(`/room/${room[1].toUpperCase()}`);
  }, [status, launchParam, router]);

  if (status === 'loading') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="grid place-items-center gap-3">
          <LogoMark size={64} />
          <LoadingState label="Signing you in…" />
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div className="grid max-w-sm place-items-center gap-4">
          <LogoMark size={64} />
          <h1 className="font-display text-xl font-extrabold">Akukulu</h1>
          <p className="text-sm text-muted">{error ?? 'Unable to sign in.'}</p>
          <button className="btn-ghost" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (status === 'needs-login') {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <form
          className="card grid w-full max-w-sm gap-4 p-6"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setLoginError(null);
            try {
              await devLogin(name.trim());
            } catch (err) {
              setLoginError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex items-center gap-3">
            <LogoMark size={44} />
            <div>
              <h1 className="font-display text-lg font-extrabold">Developer sign-in</h1>
              <p className="text-xs text-muted">Telegram is not available here. Local development only.</p>
            </div>
          </div>
          <input className="input" placeholder="Test player name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={24} required />
          {loginError && <p className="text-sm text-danger">{loginError}</p>}
          <button className="btn-primary" disabled={busy || name.trim().length < 2}>
            {busy ? 'Signing in…' : 'Continue'}
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <Gate>{children}</Gate>
    </SessionProvider>
  );
}
