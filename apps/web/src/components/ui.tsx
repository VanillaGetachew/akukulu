'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HIDDEN_CARD, RANK_LABEL, isPrintedJoker, type Card, type Rank, type Suit } from '@akukulu/shared';
import { useSession } from '@/lib/session';
import { Logo } from './art';
import { CardBack, CardFace } from './card-face';

/* ------------------------------------------------------------------ value */

/** The Akukulu point coin: champagne gold with an embossed diamond. */
export function Coin({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={`shrink-0 ${className}`} role="img" aria-label="Birr">
      <circle cx="10" cy="10" r="9.2" fill="#b08d48" />
      <circle cx="10" cy="9.4" r="8.4" fill="#e6c77f" />
      <text x="10" y="13.4" textAnchor="middle" fontSize="11" fontWeight="700" fill="#6f5522">
        ብ
      </text>
    </svg>
  );
}

export function Points({ value, signed = false }: { value: number; signed?: boolean }) {
  return (
    <span className="tabular-nums">
      {signed && value > 0 ? '+' : ''}
      {value.toLocaleString()}
    </span>
  );
}

export function BalancePill() {
  const { user } = useSession();
  return (
    <Link
      href="/wallet"
      className="flex h-10 items-center gap-2 rounded-full border border-gold/25 bg-gold/[0.06] pl-2.5 pr-3.5 text-sm font-bold text-fg transition hover:border-gold/45"
      title="Your balance in birr"
      aria-label={user ? `Balance ${user.balance.toLocaleString()} ETB` : 'Balance'}
    >
      <Coin className="h-[18px] w-[18px]" />
      {user ? <Points value={user.balance} /> : <span className="skeleton h-4 w-12" />}
    </Link>
  );
}

/* ------------------------------------------------------------------ navigation */

function RefreshButton({ onRefresh, refreshing }: { onRefresh: () => void; refreshing?: boolean }) {
  return (
    <button
      onClick={onRefresh}
      className="grid h-10 w-10 place-items-center rounded-full border border-line bg-panel text-muted transition hover:text-fg"
      aria-label="Refresh"
      title="Refresh"
    >
      <svg viewBox="0 0 24 24" className={`h-[18px] w-[18px] ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M20 12a8 8 0 1 1-2.34-5.66" />
        <path d="M20 4v5h-5" />
      </svg>
    </button>
  );
}

/** Mobile header (hidden on desktop, where the sidebar carries the brand and balance). */
export function TopBar({ onRefresh, refreshing }: { onRefresh?: () => void; refreshing?: boolean }) {
  const { connected, user } = useSession();
  return (
    <header
      className="sticky top-0 z-nav -mx-4 mb-5 flex items-center justify-between bg-ink/85 px-4 pb-3 backdrop-blur-md lg:hidden"
      style={{ paddingTop: 'calc(var(--safe-top) + 12px)' }}
    >
      <Link href="/" aria-label="Akukulu home" className="rounded-xl">
        <Logo />
      </Link>
      <div className="flex items-center gap-2">
        {user && !connected && (
          <span className="chip border-gold/30 text-gold" title="Reconnecting to the game server">
            Reconnecting…
          </span>
        )}
        {onRefresh && <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />}
        <BalancePill />
      </div>
    </header>
  );
}

const NAV = [
  { href: '/', label: 'Play', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7' },
  { href: '/wallet', label: 'Wallet', icon: 'M3 7h18v13H3zM3 7l13-4v4M16 13.5h2' },
  { href: '/leaderboard', label: 'Leaders', icon: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3' },
  { href: '/profile', label: 'Profile', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4 4-6 8-6s7 2 8 6' },
];

function useActive() {
  const path = usePathname();
  return (href: string) => (href === '/' ? path === '/' || path.startsWith('/games') : path.startsWith(href));
}

function NavIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** Mobile tab bar. */
export function BottomNav() {
  const active = useActive();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-nav border-t border-line bg-night/90 backdrop-blur-md lg:hidden" style={{ paddingBottom: 'var(--safe-bottom)' }} aria-label="Main">
      <div className="mx-auto grid max-w-3xl grid-cols-4">
        {NAV.map((n) => {
          const on = active(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={on ? 'page' : undefined}
              className={`relative flex min-h-[56px] flex-col items-center justify-center gap-1 text-[11px] font-semibold transition ${on ? 'text-lime' : 'text-muted hover:text-fg'}`}
            >
              {on && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-lime" aria-hidden />}
              <NavIcon d={n.icon} />
              {n.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Desktop sidebar: brand, destinations, balance. */
function SideNav({ onRefresh, refreshing }: { onRefresh?: () => void; refreshing?: boolean }) {
  const active = useActive();
  const { connected, user } = useSession();
  return (
    <aside className="fixed inset-y-0 left-0 z-nav hidden w-60 flex-col border-r border-line bg-night/70 px-4 pb-6 pt-6 lg:flex" aria-label="Main">
      <Link href="/" aria-label="Akukulu home" className="mb-8 rounded-xl px-2">
        <Logo />
      </Link>
      <nav className="grid gap-1">
        {NAV.map((n) => {
          const on = active(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={on ? 'page' : undefined}
              className={`flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${on ? 'bg-lime/10 text-lime' : 'text-muted hover:bg-white/[0.04] hover:text-fg'}`}
            >
              <NavIcon d={n.icon} />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto grid gap-3">
        <div className="tibeb opacity-70" aria-hidden />
        <div className="flex items-center gap-2">
          <BalancePill />
          {onRefresh && <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />}
        </div>
        {user && !connected && <span className="text-xs font-semibold text-gold">Reconnecting to the game server…</span>}
      </div>
    </aside>
  );
}

/** App shell: mobile header + tab bar, desktop sidebar; content column sized for each. */
export function Page({ children, onRefresh, refreshing, nav = true }: { children: ReactNode; onRefresh?: () => void; refreshing?: boolean; nav?: boolean }) {
  return (
    <>
      <SideNav onRefresh={onRefresh} refreshing={refreshing} />
      <div className="lg:pl-60">
        <div className={`mx-auto min-h-dvh max-w-3xl px-4 lg:max-w-[1080px] lg:px-10 lg:pt-8 ${nav ? 'pb-[calc(96px+var(--safe-bottom))] lg:pb-12' : 'pb-10'}`}>
          <TopBar onRefresh={onRefresh} refreshing={refreshing} />
          {children}
        </div>
      </div>
      {nav && <BottomNav />}
    </>
  );
}

/* ------------------------------------------------------------------ states */

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="grid place-items-center gap-3 py-16 text-sm text-muted" role="status">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-lime/25 border-t-lime" />
      {label}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <svg viewBox="0 0 48 48" className="mb-1 h-11 w-11" aria-hidden>
        <rect x="9" y="8" width="20" height="28" rx="3" fill="#172238" stroke="#e6c77f" strokeOpacity=".5" transform="rotate(-10 19 22)" />
        <rect x="19" y="12" width="20" height="28" rx="3" fill="#fbf8f1" stroke="#d6ccb6" transform="rotate(8 29 26)" />
        <path d="M29 22 33 27 29 32 25 27z" fill="#c42a2a" transform="rotate(8 29 26)" />
      </svg>
      <div className="font-display text-base font-bold">{title}</div>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card grid place-items-center gap-3 border-danger/30 px-6 py-10 text-center" role="alert">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-danger/15 text-lg font-black text-danger" aria-hidden>
        !
      </div>
      <div className="font-display text-base font-bold">That didn&apos;t load</div>
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
    <div className="pointer-events-none fixed inset-x-0 z-toast flex justify-center px-4" style={{ bottom: 'calc(88px + var(--safe-bottom))' }} role="status" aria-live="polite">
      <button
        onClick={onClose}
        className={`pointer-events-auto flex max-w-md animate-rise items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-lift ${tone === 'error' ? 'bg-[#3a1520] text-[#ffd3db] ring-1 ring-danger/40' : 'bg-[#0f3326] text-[#c8f7e1] ring-1 ring-lime/40'}`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${tone === 'error' ? 'bg-danger' : 'bg-lime'}`} aria-hidden />
        {message}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

const CARD_WIDTH = { sm: 36, md: 52, lg: 68 } as const;

/** A playing card (face or back) at one of three sizes. */
export function PlayingCard({
  card,
  size = 'md',
  delay = 0,
  highlight = false,
  selected = false,
  disabled = false,
}: {
  card: Card;
  size?: 'sm' | 'md' | 'lg';
  delay?: number;
  highlight?: boolean;
  selected?: boolean;
  disabled?: boolean;
}) {
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
      className={`animate-dealIn relative rounded-[8px] shadow-[0_2px_4px_rgba(0,0,0,.35),0_8px_18px_-8px_rgba(0,0,0,.6)] transition duration-200 ${highlight ? 'ring-2 ring-gold ring-offset-1 ring-offset-transparent' : ''} ${selected ? '-translate-y-2 ring-2 ring-lime' : ''} ${disabled ? 'opacity-45 saturate-50' : ''}`}
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

/* ------------------------------------------------------------------ people */

/** Muted jewel tones so players without a photo are still easy to tell apart. */
const AVATAR_TONES = ['#2f6b5a', '#6b4a2f', '#3b4f86', '#7a3b52', '#5b6b2f', '#4b3b7a', '#2f5f7a', '#7a5a2f'];
function toneFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

export function Avatar({ name, photoUrl, size = 32, ring }: { name: string; photoUrl?: string | null; size?: number; ring?: string }) {
  const initials = name.replace('@', '').trim().slice(0, 2).toUpperCase() || '?';
  return photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photoUrl} alt="" width={size} height={size} className={`shrink-0 rounded-full object-cover ${ring ?? ''}`} style={{ width: size, height: size }} />
  ) : (
    <div
      className={`grid shrink-0 place-items-center rounded-full font-bold text-white/95 ${ring ?? ''}`}
      style={{ width: size, height: size, background: toneFor(name), fontSize: Math.max(10, Math.round(size * 0.36)) }}
      aria-hidden
    >
      {initials}
    </div>
  );
}
