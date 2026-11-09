'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { openTelegramLink, webApp } from '@/lib/telegram';
import { Emblem } from '@/components/art';

/** New players share their Telegram phone number before they can play. Telegram sends it straight to the bot. */
export function PhoneGate() {
  const { refreshUser } = useSession();
  const [waiting, setWaiting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  async function openBot() {
    const config = await api<{ botUsername: string | null }>('/auth/config').catch(() => null);
    openTelegramLink(`https://t.me/${config?.botUsername ?? 'Akukulugamebot'}?start=phone`);
  }

  /** The number reaches the bot a moment after the player agrees, so check a few times. */
  function waitForNumber() {
    setWaiting(true);
    for (let i = 1; i <= 8; i++) timers.current.push(setTimeout(() => void refreshUser().catch(() => undefined), i * 1500));
    timers.current.push(
      setTimeout(() => {
        setWaiting(false);
        setMessage('We did not get your number yet. Please try again, or share it in the bot.');
      }, 13_000),
    );
  }

  function share() {
    setMessage(null);
    const app = webApp();
    if (!app?.requestContact) {
      void openBot();
      return;
    }
    app.requestContact((shared) => {
      if (shared) waitForNumber();
      else setMessage('Akukulu needs your phone number to keep accounts and payments safe.');
    });
  }

  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="grid max-w-sm place-items-center gap-4">
        <Emblem size={150} />
        <h1 className="font-display text-xl font-extrabold">Share your phone number</h1>
        <p className="text-sm leading-relaxed text-muted">We ask each new player for the phone number on their Telegram account, once. It is not shown to other players.</p>
        {message && <p className="text-sm text-danger">{message}</p>}
        <button className="btn-primary w-full" disabled={waiting} onClick={share}>
          {waiting ? 'Checking…' : '📱 Share my phone number'}
        </button>
        <button className="text-sm font-semibold text-muted underline underline-offset-4" onClick={() => void openBot()}>
          Share it in the bot instead
        </button>
      </div>
    </div>
  );
}
