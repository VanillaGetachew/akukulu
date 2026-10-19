'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionAck, MatchStatePayload, MatchSummary } from '@akukulu/shared';
import { useSession } from './session';
import { haptic } from './telegram';

function actionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Live, personalised match state. Re-subscribes on every (re)connect so the
 * server re-sends the latest snapshot after network drops or server restarts.
 */
export function useMatch(matchId: string | null) {
  const { socket, connected } = useSession();
  const [state, setState] = useState<MatchStatePayload | null>(null);
  const [ended, setEnded] = useState<MatchSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const clockOffset = useRef(0);

  useEffect(() => {
    if (!socket || !matchId) return;
    const onState = (s: MatchStatePayload) => {
      if (s.matchId !== matchId) return;
      clockOffset.current = s.serverTime - Date.now();
      setState((prev) => (prev && prev.version > s.version ? prev : s));
    };
    const onEnded = (m: MatchSummary) => {
      if (m.id === matchId) setEnded(m);
    };
    socket.on('match:state', onState);
    socket.on('match:ended', onEnded);
    return () => {
      socket.off('match:state', onState);
      socket.off('match:ended', onEnded);
    };
  }, [socket, matchId]);

  useEffect(() => {
    if (!socket || !matchId || !connected) return;
    socket.emit('match:subscribe', { matchId }, (res) => {
      if (!res.ok) setError(res.error ?? 'Could not load the match');
    });
  }, [socket, matchId, connected]);

  const act = useCallback(
    (action: Record<string, unknown>): Promise<ActionAck> =>
      new Promise((resolve) => {
        if (!socket || !matchId) return resolve({ ok: false, error: 'Not connected' });
        setPending(true);
        haptic('tap');
        const timeout = setTimeout(() => {
          setPending(false);
          resolve({ ok: false, error: 'The server did not respond — retrying may help' });
        }, 10_000);
        socket.emit('match:action', { matchId, clientActionId: actionId(), action }, (res) => {
          clearTimeout(timeout);
          setPending(false);
          if (!res.ok) {
            setError(res.error ?? 'Action rejected');
            haptic('error');
          } else setError(null);
          resolve(res);
        });
      }),
    [socket, matchId],
  );

  /** Server-synchronised "now" for countdowns. */
  const serverNow = useCallback(() => Date.now() + clockOffset.current, []);

  return { state, ended, error, setError, pending, act, serverNow };
}
