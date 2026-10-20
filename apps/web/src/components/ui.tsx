'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HIDDEN_CARD, RANK_LABEL, isPrintedJoker, type Card, type Rank, type Suit } from '@akukulu/shared';
import { useSession } from '@/lib/session';
import { Logo } from './art';
import { CardBack, CardFace } from './card-face';

export function Coin({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="#ffc94a" />
      <circle cx="10" cy="10" r="6" fill="none" stroke="#b07d12" strokeWidth="1.6" />
      <path d="M10 6.5 L12.5 10 L10 13.5 L7.5 10 Z" fill="#b07d12" />
    </svg>
  );
}

export function Points({ value, signed = false }: { value: number; signed?: boolean }) {
  const text = value.toLocaleString();
  return (
    <span className="tabular-nums">
      {signed && value > 0 ? '+' : ''}
      {text}
    </span>
  );
}

export function BalancePill() {
  const { user } = useSession();
  return (
    <Link href="/wallet" className="flex items-center gap-1.5 rounded-full border border-gold/30 bg-black/40 py-1.5 pl-2 pr-3 text-sm font-bold" title="Virtual points — free, non-redeemable">
      <Coin />
      {user ? <Points value={user.balance} /> : <span className="skeleton h-4 w-10" />}
    </Link>
  );
}

export function TopBar({ onRefresh, refreshing }: { onRefresh?: () => void; refreshing?: boolean }) {
  const { connected, user } = useSession();
  return (
    <header className="sticky top-0 z-30 -mx-4 mb-4 flex items-center justify-between border-b border-line bg-ink/80 px-4 py-3 backdrop-blur">
      <Link href="/" aria-label="Lobby">
        <Logo />
      </Link>
      <div className="flex items-center gap-2">
        {user && !connected && <span className="chip text-gold" title="Reconnecting to the game server">Offline</span>}
        {onRefresh && (
          <button onClick={onRefresh} className="grid h-9 w-9 place-items-center rounded-full border border-line bg-panel2 text-muted hover:text-fg" aria-label="Refresh">
            <svg viewBox="0 0 24 24" className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M20 12a8 8 0 1 1-2.34-5.66" />
              <path d="M20 4v5h-5" />
            </svg>
          </button>
        )}
        <BalancePill />
      </div>
    </header>
  );
}

const NAV = [
  { href: '/', label: 'Play', icon: 'M5 12h14M12 5v14' },
  { href: '/rewards', label: 'Rewards', icon: 'M4 10h16v10H4zM12 10v10M3 6h18v4H3zM12 6c-2-4-6-2-4 0M12 6c2-4 6-2 4 0' },
  { href: '/leaderboard', label: 'Leaders', icon: 'M8 21V11M16 21V7M12 21V3M4 21h16' },
  { href: '/profile', label: 'Profile', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4 4-6 8-6s7 2 8 6' },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink/90 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto grid max-w-3xl grid-cols-4">
        {NAV.map((n) => {
          const active = n.href === '/' ? path === '/' || path.startsWith('/games') : path.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold ${active ? 'text-lime' : 'text-muted'}`}>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={n.icon} />
              </svg>
              {n.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function Page({ children, onRefresh, refreshing, nav = true }: { children: ReactNode; onRefresh?: () => void; refreshing?: boolean; nav?: boolean }) {
  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-4 pb-28">
      <TopBar onRefresh={onRefresh} refreshing={refreshing} />
      {children}
      {nav && <BottomNav />}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="grid place-items-center py-16 text-sm text-muted" role="status">
      <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-lime/30 border-t-lime" />
      {label}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="card grid place-items-center gap-2 px-6 py-10 text-center">
      <div className="text-3xl" aria-hidden="true">🎲</div>
      <div className="font-display text-base font-bold">{title}</div>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card grid place-items-center gap-3 border-danger/30 px-6 py-10 text-center" role="alert">
      <div className="font-display text-base font-bold text-danger">Something went wrong</div>
      <p className="max-w-sm text-sm text-muted">{message}</p>
      {onRetry && (
        <button className="btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function MaintenanceState({ message }: { message: string }) {
  return (
    <div className="card grid place-items-center gap-2 border-gold/30 px-6 py-10 text-center">
      <div className="text-3xl" aria-hidden="true">🛠️</div>
      <div className="font-display text-base font-bold text-gold">Under maintenance</div>
      <p className="max-w-sm text-sm text-muted">{message}</p>
    </div>
  );
}

export function Toast({ message, tone = 'error', onClose }: { message: string | null; tone?: 'error' | 'success'; onClose: () => void }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => close.current(), 3500);
    return () => clearTimeout(t);
  }, [message]);
  if (!message) return null;
  return (
    <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4" role="status">
      <button onClick={onClose} className={`animate-pop rounded-xl px-4 py-2.5 text-sm font-semibold shadow-card ${tone === 'error' ? 'bg-danger text-white' : 'bg-lime text-ink'}`}>
        {message}
      </button>
    </div>
  );
}

const CARD_WIDTH = { sm: 36, md: 52, lg: 68 } as const;

/** A realistic playing card (face or back) at one of three sizes. */
export function PlayingCard({ card, size = 'md', delay = 0, highlight = false }: { card: Card; size?: 'sm' | 'md' | 'lg'; delay?: number; highlight?: boolean }) {
  const width = CARD_WIDTH[size];
  const style = { animationDelay: `${delay}ms`, width, height: width * 1.4 };
  const name =
    card === HIDDEN_CARD
      ? 'Hidden card'
      : isPrintedJoker(card)
        ? 'Joker'
        : `${RANK_LABEL[card[0] as Rank]} of ${{ s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }[card[1] as Suit]}`;
  return (
    <div
      style={style}
      className={`animate-dealIn relative rounded-[9px] shadow-[0_2px_5px_rgba(0,0,0,.45),0_0_0_1px_rgba(0,0,0,.06)] ${highlight ? 'outline outline-2 outline-lime' : ''}`}
      role="img"
      aria-label={name}
    >
      {card === HIDDEN_CARD ? <CardBack width={width} /> : <CardFace card={card} width={width} compact={size === 'sm'} />}
    </div>
  );
}
export function Countdown({ deadline, serverNow, total }: { deadline: number | null; serverNow: () => number; total: number }) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(t);
  }, [serverNow]);
  if (!deadline) return null;
  const left = Math.max(0, deadline - now);
  const pct = Math.min(100, (left / (total * 1000)) * 100);
  return (
    <div className="flex items-center gap-2 text-xs font-bold tabular-nums text-muted" aria-label="Time left">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full transition-[width] duration-200 ${pct < 30 ? 'bg-danger' : 'bg-lime'}`} style={{ width: `${pct}%` }} />
      </div>
      {Math.ceil(left / 1000)}s
    </div>
  );
}

export function Avatar({ name, photoUrl, size = 32, ring }: { name: string; photoUrl?: string | null; size?: number; ring?: string }) {
  const initials = name.replace('@', '').slice(0, 2).toUpperCase();
  return photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photoUrl} alt="" width={size} height={size} className={`rounded-full object-cover ${ring ?? ''}`} style={{ width: size, height: size }} />
  ) : (
    <div className={`grid place-items-center rounded-full bg-panel2 text-[11px] font-black text-fg ${ring ?? ''}`} style={{ width: size, height: size }}>
      {initials}
    </div>
  );
}
