'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  HIDDEN_CARD,
  POKER_EMOJIS,
  POKER_THROWABLES,
  POKER_TOURNAMENT_BIG_BLINDS,
  pokerMttLevel,
  type Card,
  type PokerPlayerView,
  type PokerReactionEvent,
  type PokerView,
} from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { CardBack, CardFace } from '@/components/card-face';
import { Avatar, Coin } from '@/components/ui';
import { HandHistoryList } from './poker-history';
import { nameOf, type TableProps } from './types';

/*
 * Stake-style poker table: a tall stadium-shaped table (dark rail, thin gold line, blue felt)
 * that fills the screen, seats sitting on the rail, my cards face up beside my seat at the
 * bottom, and a tournament / table panel that slides in from the right (the trophy button).
 */

const PHASE_LABEL: Record<string, string> = {
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Showdown',
  handComplete: 'Hand complete',
  waiting: 'Waiting for players',
  finished: 'Table closed',
};

/** Stake's dark-navy palette for panels and buttons. */
const UI = {
  bg: '#1a2c38',
  bg2: '#213743',
  line: '#2f4553',
  text: '#b1bad3',
  blue: '#3d9cf5',
  green: '#00e701',
  gold: '#f5b623',
  red: '#ff4e4e',
  button: '#2f4553',
};

/** 1st, 2nd, 3rd, 4th, … 11th, 12th, 13th, 21st. */
const ordinal = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
};

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
};

const fmt = (n: number) => n.toLocaleString();

function useNow(serverNow: () => number, every = 250) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), every);
    return () => clearInterval(t);
  }, [serverNow, every]);
  return now;
}

/** Tracks an element's width and height. */
function useSize<T extends HTMLElement>() {
  const [size, setSize] = useState({ w: 380, h: 600 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
    observer.current = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    observer.current.observe(el);
  }, []);
  return [ref, size] as const;
}

/** Dark maroon backdrop with a faint fleur-de-lis pattern. */
const FLEUR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'%3E%3Cg fill='%23ffffff' fill-opacity='0.045'%3E%3Cg id='f'%3E%3Cpath d='M16 2c3 5 4 10 0 16-4-6-3-11 0-16z'/%3E%3Cpath d='M14.5 17c-5 0-9-3-8.5-7.5.4-3 4-3.3 4.4-.6-1.5-.4-2.2 1.6-.8 3.1 1.5 1.6 3.8 2.6 4.9 5z'/%3E%3Cpath d='M17.5 17c5 0 9-3 8.5-7.5-.4-3-4-3.3-4.4-.6 1.5-.4 2.2 1.6.8 3.1-1.5 1.6-3.8 2.6-4.9 5z'/%3E%3Crect x='10' y='17.5' width='12' height='2.4' rx='1'/%3E%3Cpath d='M14.6 20h2.8l.9 6-2.3-2-2.3 2z'/%3E%3C/g%3E%3Cuse href='%23f' x='32' y='32'/%3E%3C/g%3E%3C/svg%3E\")";

/* ------------------------------------------------------------------ cards & chips */

/** A Stake-style table card: big index top-left, big suit bottom-right, any width. */
function TableCard({ card, width, delay = 0, highlight, dim }: { card: Card; width: number; delay?: number; highlight?: boolean; dim?: boolean }) {
  return (
    <div
      className={`animate-dealIn relative shrink-0 overflow-hidden rounded-[6px] shadow-[0_3px_8px_rgba(0,0,0,.5)] ${dim ? 'opacity-45' : ''}`}
      style={{ width, height: width * 1.4, animationDelay: `${delay}ms`, outline: highlight ? `2px solid ${UI.gold}` : undefined, outlineOffset: -1 }}
    >
      {card === HIDDEN_CARD ? <CardBack width={width} /> : <CardFace card={card} width={width} compact />}
    </div>
  );
}

/** A small blue card back, as tucked beside an opponent's avatar. */
function MiniBack({ style }: { style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 18 25" className="h-[25px] w-[18px] drop-shadow" style={style} aria-hidden>
      <rect x="0.5" y="0.5" width="17" height="24" rx="2.5" fill="#fff" />
      <rect x="2" y="2" width="14" height="21" rx="1.6" fill="#2563eb" />
      <path d="M9 6.5l3.5 6-3.5 6-3.5-6z" fill="none" stroke="#bfdbfe" strokeWidth="1.2" />
    </svg>
  );
}

/** A small stack of casino chips with the amount. */
function Chips({ amount, big }: { amount: number; big?: boolean }) {
  const colors = amount >= 1000 ? ['#7c3aed', '#f6b80e', '#e53935'] : amount >= 100 ? ['#1f7fdc', '#2e9e48', '#e53935'] : ['#2e9e48', '#e53935'];
  const stacks = big ? 2 : 1;
  const n = Math.min(4, 1 + Math.floor(Math.log10(Math.max(1, amount))));
  const size = big ? 24 : 21;
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex -space-x-1.5">
        {Array.from({ length: stacks }, (_, s) => (
          <div key={s} className="relative" style={{ width: size, height: size + n * 3 }}>
            {Array.from({ length: n }, (_, i) => (
              <svg key={i} viewBox="0 0 40 40" className="absolute left-0" style={{ bottom: i * 3, width: size, height: size }}>
                <circle cx="20" cy="20" r="18" fill={colors[(i + s) % colors.length]} stroke="#fff" strokeWidth="2" />
                <circle cx="20" cy="20" r="12" fill="none" stroke="#fff" strokeWidth="3" strokeDasharray="5 5" opacity="0.9" />
                <circle cx="20" cy="20" r="7" fill="#fff" opacity="0.92" />
              </svg>
            ))}
          </div>
        ))}
      </div>
      <span className={`font-bold tabular-nums text-white [text-shadow:0_1px_2px_rgba(0,0,0,.6)] ${big ? 'text-[15px]' : 'text-[14px]'}`}>{fmt(amount)}</span>
    </div>
  );
}

/** The light grey hand-strength tag under a seat ("Two Pair: As & Ks"). */
function HandTag({ label, gold }: { label: string; gold?: boolean }) {
  return (
    <div
      className="mt-0.5 max-w-[96px] truncate rounded-[4px] px-1.5 text-center text-[10px] font-bold leading-[15px] shadow"
      style={{ background: gold ? UI.gold : '#d5dbe6', color: '#1a2c38' }}
      title={label}
    >
      {label}
    </div>
  );
}

/* ------------------------------------------------------------------ seats */

/** A seat: round avatar on the rail with the name / stack box just under it. */
function Seat({
  p,
  name,
  photoUrl,
  you,
  turn,
  winner,
  ratio,
  secs,
  tournament,
  waiting,
  cardW,
  onAvatar,
}: {
  p: PokerPlayerView;
  name: string;
  photoUrl?: string | null;
  you: boolean;
  turn: boolean;
  winner: boolean;
  ratio: number;
  secs: number;
  tournament: boolean;
  waiting: boolean;
  cardW: number;
  onAvatar?: () => void;
}) {
  const out = p.status !== 'active';
  const tag =
    p.status === 'busted'
      ? tournament && p.place ? `Out · ${ordinal(p.place)}` : 'Busted'
      : p.status === 'left'
        ? 'Left'
        : p.folded
          ? 'Fold'
          : p.allIn
            ? 'All-in'
            : waiting
              ? 'Next hand'
              : null;
  const R = 22;
  const C = 2 * Math.PI * R;
  const holding = !you && p.inHand && !p.folded && p.hole.length > 0;
  // Face-up cards: shown down, or shown by choice after the hand (one may still be face down).
  const faceUp = !you && p.hole.length > 0 && p.hole.some((c) => c !== HIDDEN_CARD);
  const shownW = Math.round(cardW * 0.82);
  return (
    <div className="flex w-[80px] flex-col items-center">
      <div
        className={`relative grid h-[48px] w-[48px] place-items-center ${out || (p.folded && !faceUp) ? 'opacity-55' : ''} ${onAvatar ? 'cursor-pointer' : ''}`}
        onClick={onAvatar}
        role={onAvatar ? 'button' : undefined}
        aria-label={onAvatar ? (you ? 'Send an emoji' : `React to ${name}`) : undefined}
      >
        <div className={`relative rounded-full ring-2 ${turn ? 'ring-transparent' : winner ? 'ring-[#f5b623]' : 'ring-[#15202a]'}`}>
          <Avatar name={name} photoUrl={photoUrl} size={44} />
        </div>
        {/* Two small card backs at the avatar's shoulder while the hand is on. */}
        {holding && !faceUp && (
          <div className="absolute left-[calc(100%+2px)] top-1 z-[2] flex">
            {p.hole.map((_, i) => (
              <MiniBack key={i} style={{ transform: `rotate(${i ? 12 : -4}deg)`, marginLeft: i ? -11 : 0 }} />
            ))}
          </div>
        )}
        {/* Shown-down cards cover the avatar, side by side, as on Stake. */}
        {faceUp && (
          <div className="absolute bottom-[2px] left-1/2 z-[3] flex -translate-x-1/2 gap-[2px]">
            {p.hole.map((c, i) => (
              <TableCard key={`${c}${i}`} card={c} width={shownW} />
            ))}
          </div>
        )}
        {turn && (
          <>
            <svg viewBox="0 0 48 48" className="absolute inset-0 z-[4] -rotate-90">
              <circle cx="24" cy="24" r={R} fill="none" stroke="rgba(0,0,0,.45)" strokeWidth="3" />
              <circle cx="24" cy="24" r={R} fill="none" stroke={ratio > 0.3 ? UI.green : UI.red} strokeWidth="3" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - ratio)} />
            </svg>
          </>
        )}
      </div>
      {/* Name and stack in one box, tucked under the avatar. */}
      <div
        className={`relative z-[3] mt-1.5 w-full rounded-[5px] px-1 py-[3px] text-center shadow-[0_4px_10px_rgba(0,0,0,.45)] ${out || p.folded ? 'opacity-70' : ''}`}
        style={{
          background: 'rgba(26,44,56,.96)',
          boxShadow: turn ? `0 0 0 1.5px ${UI.green}, 0 4px 10px rgba(0,0,0,.45)` : winner ? `0 0 0 1.5px ${UI.gold}, 0 4px 10px rgba(0,0,0,.45)` : undefined,
        }}
      >
        <div className={`truncate text-[11px] font-medium leading-[14px]`} style={{ color: UI.text }}>
          {you ? 'You' : name}
        </div>
        <div className="text-[13px] font-bold tabular-nums leading-[16px] text-white">{fmt(p.stack)}</div>
        {tag && (
          <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[3px] bg-[#d5dbe6] px-1.5 text-[9px] font-extrabold uppercase leading-[13px] text-[#1a2c38] shadow">
            {tag}
          </span>
        )}
      </div>
      {p.handLabel && (!p.folded || faceUp) && <HandTag label={p.handLabel} gold={winner} />}
    </div>
  );
}

/* ------------------------------------------------------------------ reactions */

type Live = PokerReactionEvent & { born: number };

/** An emoji popping above the sender's seat. */
function EmojiPop({ x, y, emoji }: { x: number; y: number; emoji: string }) {
  return (
    <div className="pointer-events-none absolute z-[30]" style={{ left: x, top: y - 46, transform: 'translate(-50%, -50%)' }}>
      <div className="reaction-pop grid h-14 w-14 place-items-center rounded-full bg-white/95 text-[34px] leading-none shadow-[0_6px_16px_rgba(0,0,0,.45)]">{emoji}</div>
    </div>
  );
}

/** Something thrown from one seat to another: it flies in an arc, spins, then splats on the target. */
function Throwable({ from, to, emoji }: { from: { x: number; y: number }; to: { x: number; y: number }; emoji: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return;
    const mx = (from.x + to.x) / 2;
    const my = Math.min(from.y, to.y) - 70;
    el.animate(
      [
        { transform: `translate(${from.x}px, ${from.y}px) translate(-50%, -50%) scale(.6) rotate(0deg)`, opacity: 0 },
        { transform: `translate(${from.x}px, ${from.y}px) translate(-50%, -50%) scale(1) rotate(0deg)`, opacity: 1, offset: 0.08 },
        { transform: `translate(${mx}px, ${my}px) translate(-50%, -50%) scale(1.35) rotate(200deg)`, offset: 0.5 },
        { transform: `translate(${to.x}px, ${to.y}px) translate(-50%, -50%) scale(1) rotate(400deg)`, offset: 0.78 },
        { transform: `translate(${to.x}px, ${to.y}px) translate(-50%, -50%) scale(1.9) rotate(400deg)`, opacity: 1, offset: 0.86 },
        { transform: `translate(${to.x}px, ${to.y}px) translate(-50%, -50%) scale(1.6) rotate(400deg)`, opacity: 0 },
      ],
      { duration: 1900, easing: 'ease-in-out', fill: 'forwards' },
    );
  }, [from.x, from.y, to.x, to.y]);
  return (
    <div ref={ref} className="pointer-events-none absolute left-0 top-0 z-[30] text-[34px] leading-none drop-shadow-[0_4px_6px_rgba(0,0,0,.5)]" style={{ opacity: 0 }}>
      {emoji}
    </div>
  );
}

/** Picker: emojis for myself, or throwables at another player. */
function ReactionPicker({ title, items, onPick, onClose }: { title: string; items: readonly string[]; onPick: (e: string) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[44] flex items-end justify-center px-3 pb-[calc(64px+env(safe-area-inset-bottom))]" onClick={onClose}>
      <div
        className="w-full max-w-[340px] animate-pop rounded-[10px] p-2.5 shadow-2xl"
        style={{ background: UI.bg, border: `1px solid ${UI.line}` }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="mb-2 truncate px-1 text-[12px] font-semibold" style={{ color: UI.text }}>
          {title}
        </div>
        <div className="grid grid-cols-6 gap-1.5">
          {items.map((e) => (
            <button key={e} className="grid aspect-square place-items-center rounded-[8px] text-[26px] leading-none active:scale-90" style={{ background: UI.bg2 }} onClick={() => onPick(e)} aria-label={`Send ${e}`}>
              {e}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ seat geometry */

/** A spot on the stadium: on the top or bottom arc (degrees from centre, + is right), or on a straight side (0 = top, 1 = bottom). */
type Spot = { a: 'T' | 'B'; deg: number } | { a: 'L' | 'R'; f: number };

/** Portrait seat layouts, clockwise from me at the bottom: up the left side, across the top, down the right. */
const LAYOUTS: Record<number, Spot[]> = {
  1: [{ a: 'B', deg: 0 }],
  2: [{ a: 'B', deg: 0 }, { a: 'T', deg: 0 }],
  3: [{ a: 'B', deg: 0 }, { a: 'L', f: 0.3 }, { a: 'R', f: 0.3 }],
  4: [{ a: 'B', deg: 0 }, { a: 'L', f: 0.5 }, { a: 'T', deg: 0 }, { a: 'R', f: 0.5 }],
  5: [{ a: 'B', deg: 0 }, { a: 'L', f: 0.62 }, { a: 'T', deg: -40 }, { a: 'T', deg: 40 }, { a: 'R', f: 0.62 }],
  6: [{ a: 'B', deg: 0 }, { a: 'L', f: 0.95 }, { a: 'L', f: 0.05 }, { a: 'T', deg: 0 }, { a: 'R', f: 0.05 }, { a: 'R', f: 0.95 }],
  7: [{ a: 'B', deg: 0 }, { a: 'L', f: 0.98 }, { a: 'L', f: 0.02 }, { a: 'T', deg: -42 }, { a: 'T', deg: 42 }, { a: 'R', f: 0.02 }, { a: 'R', f: 0.98 }],
  8: [
    { a: 'B', deg: 0 },
    { a: 'L', f: 1 },
    { a: 'L', f: 0 },
    { a: 'T', deg: -52 },
    { a: 'T', deg: 0 },
    { a: 'T', deg: 52 },
    { a: 'R', f: 0 },
    { a: 'R', f: 1 },
  ],
  9: [
    { a: 'B', deg: 0 },
    { a: 'L', f: 0.86 },
    { a: 'L', f: 0.4 },
    { a: 'T', deg: -62 },
    { a: 'T', deg: -20 },
    { a: 'T', deg: 20 },
    { a: 'T', deg: 62 },
    { a: 'R', f: 0.4 },
    { a: 'R', f: 0.86 },
  ],
  10: [
    { a: 'B', deg: 0 },
    { a: 'L', f: 0.9 },
    { a: 'L', f: 0.5 },
    { a: 'L', f: 0.1 },
    { a: 'T', deg: -50 },
    { a: 'T', deg: 0 },
    { a: 'T', deg: 50 },
    { a: 'R', f: 0.1 },
    { a: 'R', f: 0.5 },
    { a: 'R', f: 0.9 },
  ],
};

/* ------------------------------------------------------------------ actions */

function ActionButton({ children, onClick, disabled, tone }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone: 'grey' | 'blue' | 'green' }) {
  const style =
    tone === 'green' ? { background: UI.green, color: '#05140a' } : tone === 'blue' ? { background: '#1475e1', color: '#fff' } : { background: UI.button, color: '#fff' };
  return (
    <button
      className="h-11 min-w-0 flex-1 truncate rounded-[6px] px-2 text-[13px] font-extrabold shadow-[0_3px_0_rgba(0,0,0,.35)] active:translate-y-[1px] disabled:opacity-50"
      style={style}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Fold / Check-Call / Raise; Raise opens a sizing panel above the buttons. */
function ActionBar({ view, act, pending }: { view: PokerView; act: TableProps<PokerView>['act']; pending: boolean }) {
  const legal = view.legal!;
  const [amount, setAmount] = useState(legal.minAmount);
  const [sizing, setSizing] = useState(false);
  useEffect(() => {
    setAmount(legal.minAmount);
    setSizing(false);
  }, [legal.minAmount, view.handNumber, view.phase]);
  const aggressive = legal.canBet || legal.canRaise;
  // Pot-sized raises: "raise to" = current bet + fraction × (pot after calling).
  const afterCall = view.pot + legal.callAmount;
  const presets = [
    { label: '½ Pot', value: view.currentBet + Math.floor(afterCall / 2) },
    { label: '¾ Pot', value: view.currentBet + Math.floor((afterCall * 3) / 4) },
    { label: 'Pot', value: view.currentBet + afterCall },
  ].filter((p) => p.value > legal.minAmount && p.value < legal.maxAmount);
  const allIn = amount >= legal.maxAmount;
  const raise = () => void act(allIn ? { type: 'allIn' } : { type: legal.canBet ? 'bet' : 'raise', amount });
  return (
    <div className="relative flex w-full gap-1.5">
      {sizing && aggressive && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-[20] grid gap-2 rounded-[8px] p-2.5 shadow-2xl" style={{ background: UI.bg, border: `1px solid ${UI.line}` }}>
          <div className="grid grid-cols-5 gap-1">
            {[{ label: 'Min', value: legal.minAmount }, ...presets, { label: 'Max', value: legal.maxAmount }].map((p) => (
              <button
                key={p.label}
                className="rounded-[5px] py-1.5 text-[11px] font-bold text-white"
                style={{ background: amount === p.value ? '#1475e1' : UI.bg2 }}
                onClick={() => setAmount(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={legal.minAmount}
              max={legal.maxAmount}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="h-2 flex-1 accent-[#00e701]"
              aria-label="Bet amount"
            />
            <span className="w-20 rounded-[5px] px-2 py-1 text-right text-sm font-black tabular-nums text-white" style={{ background: '#0f212e' }}>
              {fmt(amount)}
            </span>
          </div>
        </div>
      )}
      <ActionButton tone="grey" disabled={pending} onClick={() => void act({ type: 'fold' })}>
        Fold
      </ActionButton>
      {legal.canCheck ? (
        <ActionButton tone="blue" disabled={pending} onClick={() => void act({ type: 'check' })}>
          Check
        </ActionButton>
      ) : (
        <ActionButton tone="blue" disabled={pending} onClick={() => void act({ type: 'call' })}>
          Call {fmt(legal.callAmount)}
        </ActionButton>
      )}
      {aggressive ? (
        <ActionButton tone="green" disabled={pending} onClick={() => (sizing ? raise() : setSizing(true))}>
          {sizing ? (
            allIn ? (
              'All-in'
            ) : (
              <span className="flex flex-col leading-[14px]">
                <span className="text-[10px] font-bold opacity-75">{legal.canBet ? 'Bet' : 'Raise to'}</span>
                <span className="tabular-nums">{fmt(amount)}</span>
              </span>
            )
          ) : legal.canBet ? (
            'Bet'
          ) : (
            'Raise'
          )}
        </ActionButton>
      ) : (
        <ActionButton tone="green" disabled={pending || legal.callAmount === 0} onClick={() => void act({ type: 'allIn' })}>
          All-in
        </ActionButton>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ panels */

/** A panel that slides up from the bottom of the table. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[45] flex items-end justify-center bg-black/60 backdrop-blur-[2px]" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="max-h-[82vh] w-full max-w-[560px] animate-pop overflow-y-auto rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white shadow-2xl"
        style={{ background: UI.bg, border: `1px solid ${UI.line}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-extrabold">{title}</h2>
          <button className="grid h-8 w-8 place-items-center rounded-full text-sm font-bold" style={{ background: UI.bg2 }} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** One labelled value in the panel grid: white label, blue value. */
function Cell({ label, value, className = '', big }: { label: ReactNode; value: ReactNode; className?: string; big?: boolean }) {
  return (
    <div className={`flex flex-col justify-center px-2 py-2 ${className}`} style={{ borderColor: UI.line }}>
      <div className="text-[12px] leading-4 text-white">{label}</div>
      <div className={`tabular-nums ${big ? 'text-[15px]' : 'text-[13px]'} font-semibold leading-5`} style={{ color: UI.blue }}>
        {value}
      </div>
    </div>
  );
}

function TabIcon({ kind }: { kind: 'players' | 'prizes' | 'blinds' | 'history' }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" aria-hidden>
      {kind === 'players' && (
        <>
          <circle cx="10" cy="6.5" r="3.2" fill="currentColor" />
          <path d="M3.8 17c.6-3.6 3.1-5.4 6.2-5.4s5.6 1.8 6.2 5.4z" fill="currentColor" />
        </>
      )}
      {kind === 'prizes' && (
        <>
          <circle cx="10" cy="8" r="5" {...p} />
          <path d="M7 12.2 5.8 18l4.2-2.2 4.2 2.2-1.2-5.8" {...p} />
          <circle cx="10" cy="8" r="2" fill="currentColor" />
        </>
      )}
      {kind === 'blinds' && (
        <>
          <rect x="3" y="10" width="3.4" height="7" rx="0.8" fill="currentColor" />
          <rect x="8.3" y="6" width="3.4" height="11" rx="0.8" fill="currentColor" />
          <rect x="13.6" y="3" width="3.4" height="14" rx="0.8" fill="currentColor" />
        </>
      )}
      {kind === 'history' && (
        <>
          <rect x="2.5" y="6" width="15" height="8" rx="4" {...p} />
          <circle cx="13.5" cy="10" r="2.2" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

type InfoTab = 'players' | 'prizes' | 'blinds' | 'history';

/** Rows under the tabs, in Stake's "Place | Payout" table style. */
function ListHead({ cols }: { cols: string[] }) {
  return (
    <div className="flex px-4 py-2.5 text-[12px]" style={{ color: UI.text, borderBottom: `1px solid ${UI.line}` }}>
      {cols.map((c, i) => (
        <span key={c} className={i === 0 ? 'w-[38%]' : i === cols.length - 1 && cols.length > 2 ? 'ml-auto text-right' : 'flex-1'}>
          {c}
        </span>
      ))}
    </div>
  );
}

function ListRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center px-4 py-3 text-[13px] text-white" style={{ borderBottom: `1px solid ${UI.line}` }}>
      {children}
    </div>
  );
}

/**
 * The trophy panel: a drawer from the right. For a tournament it mirrors Stake's lobby —
 * prize pool, 1st place / next prize / places paid, the level clock with blinds and stacks,
 * then Players / Prizes / Blinds / History tabs. At a cash table it shows the table's details.
 */
function InfoDrawer({
  view,
  state,
  now,
  meId,
  onClose,
}: {
  view: PokerView;
  state: TableProps<PokerView>['state'];
  now: number;
  meId: string | undefined;
  onClose: () => void;
}) {
  const t = view.tournament;
  const cash = view.cash ?? null;
  const [tab, setTab] = useState<InfoTab>(t ? 'prizes' : 'players');
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, []);
  const close = () => {
    setShown(false);
    setTimeout(onClose, 180);
  };

  const blinds = (sb: number, bb: number, ante?: number | null) => `${fmt(sb)}/${fmt(bb)}${ante ? ` ante ${fmt(ante)}` : ''}`;
  const active = view.players.filter((p) => p.status === 'active');
  const stacks = t?.stacks ?? (active.length ? { min: Math.min(...active.map((p) => p.stack)), max: Math.max(...active.map((p) => p.stack)), avg: Math.round(active.reduce((s, p) => s + p.stack, 0) / active.length) } : null);
  const lateOpen = t?.lateRegEndsAt != null && t.lateRegEndsAt > now;
  const paid = t?.payouts.length ?? 0;
  const nextPrize = t && paid ? t.payouts[Math.min(t.playersLeft, paid) - 1] : 0;
  const mtt = t?.kind === 'mtt';
  const bigClock = t
    ? mtt
      ? t.levelEndsAt
        ? t.levelEndsAt > now ? clock(t.levelEndsAt - now) : '00:00'
        : '--:--'
      : t.nextBigBlind
        ? `${t.handsToNextLevel} hand${t.handsToNextLevel === 1 ? '' : 's'}`
        : 'Last level'
    : null;

  const tabs: InfoTab[] = t ? ['players', 'prizes', 'blinds', 'history'] : ['players', 'history'];
  const tabLabel: Record<InfoTab, string> = { players: 'Players', prizes: 'Prizes', blinds: 'Blinds', history: 'Hands' };

  // Blind structure: Sit & Go rises by hands; scheduled tournaments by the clock, with antes.
  const levels = POKER_TOURNAMENT_BIG_BLINDS.map((bb, i) => (mtt ? pokerMttLevel(i) : { smallBlind: bb / 2, bigBlind: bb, ante: 0 }));
  const levelLength = mtt ? `${view.config.levelMinutes ?? 10} min` : `${view.config.levelHands ?? 6} hands`;

  const ranked = [...view.players].sort((a, b) => {
    const out = (p: PokerPlayerView) => (p.status === 'active' ? 0 : 1);
    return out(a) - out(b) || b.stack - a.stack || (a.place ?? 99) - (b.place ?? 99);
  });

  return (
    <div className="fixed inset-0 z-[45]" role="dialog" aria-modal="true" aria-label={t ? 'Tournament info' : 'Table info'}>
      <div className={`absolute inset-0 bg-black/55 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`} onClick={close} />
      <div
        className={`absolute bottom-0 right-0 top-0 flex flex-col overflow-hidden text-white shadow-[-12px_0_30px_rgba(0,0,0,.5)] transition-transform duration-200 ease-out ${shown ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width: 'min(100%, max(340px, 64%))', maxWidth: 460, background: UI.bg }}
      >
        <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {/* Header: prize pool and late registration (tournament), or the table name (cash). */}
          <div className="flex items-start gap-2 px-3 pb-2 pt-3">
            {t ? (
              <div className="flex items-center gap-1.5 text-[15px] font-bold tabular-nums" style={{ color: UI.gold }}>
                <TrophyIcon className="h-[18px] w-[18px]" />
                {fmt(t.prizePool)}
              </div>
            ) : (
              <div className="min-w-0">
                <div className="truncate text-[15px] font-bold">{cash?.name ?? "Hold'em"}</div>
                <div className="text-[12px]" style={{ color: UI.text }}>
                  Cash game · No-Limit Hold&apos;em
                </div>
              </div>
            )}
            <div className="ml-auto flex items-start gap-2">
              {t && (mtt || t.lateRegEndsAt != null) && (
                <div className="text-right text-[12px] font-semibold leading-4" style={{ color: lateOpen ? UI.green : UI.red }}>
                  Late Registration:
                  <br />
                  {lateOpen ? clock(t.lateRegEndsAt! - now) : 'Ended'}
                </div>
              )}
              <button aria-label="Close" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold" style={{ background: UI.bg2 }} onClick={close}>
                ✕
              </button>
            </div>
          </div>

          {t ? (
            <>
              <div className="grid grid-cols-3 text-center" style={{ borderTop: `1px solid ${UI.line}`, borderBottom: `1px solid ${UI.line}` }}>
                <Cell label="1-st Place" value={fmt(t.payouts[0] ?? 0)} className="items-center border-r" />
                <Cell label="Next Prize" value={fmt(nextPrize ?? 0)} className="items-center border-r" />
                <Cell label="Places Paid" value={paid} className="items-center" />
              </div>
              <div className="grid grid-cols-[0.95fr_1.9fr_0.95fr]" style={{ borderBottom: `1px solid ${UI.line}` }}>
                <div className="grid grid-rows-3 border-r" style={{ borderColor: UI.line }}>
                  <Cell label="Level" value={t.level} className="border-b" />
                  <Cell label="Players Left" value={`${t.playersLeft}/${t.entrants}`} className="border-b" />
                  <Cell label="My position" value={t.myPlace != null ? ordinal(t.myPlace) : t.myRank != null ? `${t.myRank}/${t.playersLeft}` : '-'} />
                </div>
                <div className="flex flex-col items-center justify-center gap-0.5 border-r px-1 py-2 text-center" style={{ borderColor: UI.line }}>
                  <div className={`font-bold tabular-nums leading-none text-white ${bigClock && bigClock.length > 6 ? 'text-[22px]' : 'text-[34px]'}`}>{bigClock}</div>
                  <div className="mt-1.5 text-[12px] text-white">Blinds</div>
                  <div className="text-[12px] font-semibold tabular-nums leading-4" style={{ color: UI.blue }}>
                    {blinds(t.smallBlind, t.bigBlind, t.ante)}
                  </div>
                  <div className="mt-1 text-[12px] text-white">Next blinds</div>
                  <div className="text-[12px] font-semibold tabular-nums leading-4" style={{ color: UI.blue }}>
                    {t.nextBigBlind ? blinds(t.nextSmallBlind!, t.nextBigBlind, t.nextAnte) : '—'}
                  </div>
                  {stacks && (
                    <>
                      <div className="mt-1 text-[12px] text-white">Min/Avg/Max stacks</div>
                      <div className="text-[11px] font-semibold tabular-nums leading-4" style={{ color: UI.blue }}>
                        {fmt(stacks.min)} / {fmt(stacks.avg)} / {fmt(stacks.max)}
                      </div>
                    </>
                  )}
                </div>
                <div className="grid grid-rows-3">
                  <Cell label="Rebuys" value="Disallowed" className="border-b" />
                  <Cell label="Addons" value="Disallowed" className="border-b" />
                  <Cell label="Re-Entries" value="Disallowed" />
                </div>
              </div>
              <div className="flex items-center justify-between px-3 py-2.5 text-[13px]" style={{ borderBottom: `1px solid ${UI.line}` }}>
                <span className="text-white">{mtt ? 'Tables' : 'Level length'}</span>
                <span className="text-white">{mtt ? (t.tables ?? 1) : levelLength}</span>
              </div>
            </>
          ) : (
            <div style={{ borderTop: `1px solid ${UI.line}` }}>
              <div className="grid grid-cols-3 text-center" style={{ borderBottom: `1px solid ${UI.line}` }}>
                <Cell label="Blinds" value={blinds(view.config.smallBlind, view.config.bigBlind, view.config.ante)} className="items-center border-r" />
                <Cell label="Seated" value={`${active.length}/${view.config.maxSeats}`} className="items-center border-r" />
                <Cell label="Hand" value={view.handNumber ? `#${view.handNumber}` : '-'} className="items-center" />
              </div>
              {cash && (
                <div className="grid grid-cols-2 text-center" style={{ borderBottom: `1px solid ${UI.line}` }}>
                  <Cell label="Min buy-in" value={fmt(cash.minBuyIn)} className="items-center border-r" />
                  <Cell label="Max buy-in" value={fmt(cash.maxBuyIn)} className="items-center" />
                </div>
              )}
              {stacks && (
                <div className="flex items-center justify-between px-3 py-2.5 text-[13px]" style={{ borderBottom: `1px solid ${UI.line}` }}>
                  <span className="text-white">Min/Avg/Max stacks</span>
                  <span className="tabular-nums" style={{ color: UI.blue }}>
                    {fmt(stacks.min)} / {fmt(stacks.avg)} / {fmt(stacks.max)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Tabs: icon only, the active one shows its label too. */}
          <div className="flex" style={{ background: UI.bg2 }}>
            {tabs.map((k) => (
              <button
                key={k}
                className="flex flex-1 items-center justify-center gap-1.5 py-3 text-[13px] font-semibold"
                style={{ color: tab === k ? '#fff' : UI.text, background: tab === k ? UI.line : 'transparent' }}
                onClick={() => setTab(k)}
                aria-label={tabLabel[k]}
              >
                <TabIcon kind={k} />
                {tab === k && <span>{tabLabel[k]}</span>}
              </button>
            ))}
          </div>

          {tab === 'prizes' && t && (
            <div>
              <ListHead cols={['Place', 'Payout']} />
              {t.payouts.map((prize, i) => (
                <ListRow key={i}>
                  <span className="w-[38%]">{ordinal(i + 1)} place</span>
                  <span className="flex items-center gap-1.5 tabular-nums">
                    <Coin className="h-4 w-4" />
                    {fmt(prize)}
                  </span>
                </ListRow>
              ))}
            </div>
          )}
          {tab === 'players' && (
            <div>
              <ListHead cols={['Player', 'Stack', t ? 'Place' : 'Seat']} />
              {ranked.length === 0 && (
                <div className="px-4 py-6 text-center text-[13px]" style={{ color: UI.text }}>
                  No one is seated yet.
                </div>
              )}
              {ranked.map((p, i) => {
                const info = state.players.find((x) => x.userId === p.playerId);
                return (
                  <ListRow key={p.playerId}>
                    <span className="flex w-[38%] min-w-0 items-center gap-2">
                      <Avatar name={info?.displayName ?? 'Player'} photoUrl={info?.photoUrl} size={22} />
                      <span className={`truncate ${p.playerId === meId ? 'font-bold' : ''}`} style={{ color: p.status === 'active' ? '#fff' : UI.text }}>
                        {p.playerId === meId ? 'You' : (info?.displayName ?? 'Player')}
                      </span>
                    </span>
                    <span className="flex-1 tabular-nums" style={{ color: p.status === 'active' ? UI.blue : UI.text }}>
                      {p.status === 'active' ? fmt(p.stack) : p.status === 'left' ? 'Left' : 'Out'}
                    </span>
                    <span className="ml-auto tabular-nums" style={{ color: UI.text }}>
                      {t ? (p.place ? ordinal(p.place) : p.status === 'active' ? i + 1 : '-') : p.seat + 1}
                    </span>
                  </ListRow>
                );
              })}
            </div>
          )}
          {tab === 'blinds' && t && (
            <div>
              <ListHead cols={['Level', 'Blinds', 'Length']} />
              {levels.map((l, i) => (
                <ListRow key={i}>
                  <span className="w-[38%]" style={{ color: i + 1 === t.level ? UI.green : undefined }}>
                    {i + 1}
                  </span>
                  <span className="flex-1 tabular-nums" style={{ color: i + 1 === t.level ? UI.green : UI.blue }}>
                    {blinds(l.smallBlind, l.bigBlind, l.ante)}
                  </span>
                  <span className="ml-auto" style={{ color: UI.text }}>
                    {levelLength}
                  </span>
                </ListRow>
              ))}
            </div>
          )}
          {tab === 'history' && (
            <div className="p-3">
              <HandHistoryList matchId={state.matchId} empty="No hands at this table yet." />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ sit down */

/** Buy-in picker for a free seat at a cash table. */
function SitDown({ matchId, seat, cash, onDone }: { matchId: string; seat: number; cash: NonNullable<PokerView['cash']>; onDone: () => void }) {
  const { user } = useSession();
  const balance = user?.balance ?? 0;
  const max = Math.min(cash.maxBuyIn, balance);
  const [amount, setAmount] = useState(Math.max(cash.minBuyIn, Math.min(max, cash.maxBuyIn)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = balance < cash.minBuyIn;
  const sit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/poker/tables/${matchId}/sit`, { body: { buyIn: amount, seat } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <p className="text-sm" style={{ color: UI.text }}>
        Buy in for {fmt(cash.minBuyIn)}–{fmt(cash.maxBuyIn)} chips. You are dealt in from the next hand (posting a big blind if a game is running) and can stand up
        with your chips at any time.
      </p>
      {short ? (
        <p className="rounded-lg bg-danger/15 px-3 py-2 text-sm font-bold text-danger">You need at least {fmt(cash.minBuyIn)} points to sit here.</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <input type="range" min={cash.minBuyIn} max={max} step={Math.max(1, Math.floor(cash.minBuyIn / 40))} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="h-2 flex-1 accent-[#00e701]" aria-label="Buy-in" />
            <span className="flex w-24 items-center justify-end gap-1 text-base font-black tabular-nums text-white">
              <Coin className="h-4 w-4" /> {fmt(amount)}
            </span>
          </div>
          <div className="flex gap-2 text-xs font-bold">
            <button className="rounded-[5px] px-3 py-1.5" style={{ background: UI.bg2 }} onClick={() => setAmount(cash.minBuyIn)}>
              Min
            </button>
            <button className="rounded-[5px] px-3 py-1.5" style={{ background: UI.bg2 }} onClick={() => setAmount(max)}>
              Max
            </button>
            <span className="ml-auto self-center" style={{ color: UI.text }}>
              Balance {fmt(balance)}
            </span>
          </div>
          <button className="rounded-[6px] py-3 text-sm font-black disabled:opacity-50" style={{ background: UI.green, color: '#05140a' }} disabled={busy} onClick={sit}>
            {busy ? 'Sitting down…' : `Sit down with ${fmt(amount)}`}
          </button>
        </>
      )}
      {error && <p className="text-sm font-bold text-danger">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ chrome */

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className="h-[11px] w-[11px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10z" />
      <circle cx="10" cy="10" r="2.4" fill={open ? 'currentColor' : 'none'} />
      {!open && <path d="M3 17 17 3" />}
    </svg>
  );
}

function TrophyIcon({ className = 'h-[18px] w-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="currentColor" aria-hidden>
      <path d="M5 2.5h10v1.8h2.5v2.2a3.5 3.5 0 0 1-3.3 3.5A5 5 0 0 1 11 12.3v2.2h3v2.5H6v-2.5h3v-2.2a5 5 0 0 1-3.2-2.3A3.5 3.5 0 0 1 2.5 6.5V4.3H5V2.5zm0 3.3H4v.7c0 .8.5 1.5 1.2 1.8A5 5 0 0 1 5 7.5V5.8zm10 0v1.7c0 .3 0 .6-.1.8.7-.3 1.1-1 1.1-1.8v-.7h-1z" />
    </svg>
  );
}

function RoundButton({ label, onClick, children, size = 36 }: { label: string; onClick: () => void; children: ReactNode; size?: number }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid shrink-0 place-items-center rounded-full text-white shadow-[0_3px_8px_rgba(0,0,0,.45)] active:scale-95"
      style={{ width: size, height: size, background: '#2f3a46' }}
    >
      {children}
    </button>
  );
}

/** A tiny face-up card for the table tab ("K♦ A♠" pill, as on Stake). */
function TabCard({ card }: { card: Card }) {
  return (
    <div className="overflow-hidden rounded-[3px]" style={{ width: 17, height: 24 }}>
      <CardFace card={card} width={17} compact />
    </div>
  );
}

/* ------------------------------------------------------------------ table */

export function PokerTable({ state, view, act, pending, serverNow }: TableProps<PokerView>) {
  const { user, socket } = useSession();
  // Live reactions (emoji pops and throwables) at this table.
  const [reactions, setReactions] = useState<Live[]>([]);
  const [picker, setPicker] = useState<null | { to: string | null }>(null);
  const [reactionNote, setReactionNote] = useState<string | null>(null);
  useEffect(() => {
    if (!socket) return;
    const onReaction = (r: PokerReactionEvent) => {
      if (r.matchId !== state.matchId) return;
      setReactions((list) => (list.some((x) => x.id === r.id) ? list : [...list.slice(-11), { ...r, born: Date.now() }]));
      setTimeout(() => setReactions((list) => list.filter((x) => x.id !== r.id)), r.to ? 2100 : 2600);
    };
    socket.on('match:reaction', onReaction);
    return () => {
      socket.off('match:reaction', onReaction);
    };
  }, [socket, state.matchId]);
  useEffect(() => {
    if (!reactionNote) return;
    const t = setTimeout(() => setReactionNote(null), 1800);
    return () => clearTimeout(t);
  }, [reactionNote]);
  const sendReaction = (emoji: string, to: string | null) => {
    setPicker(null);
    socket?.emit('match:reaction', { matchId: state.matchId, to, emoji }, (res) => {
      if (!res.ok) setReactionNote(res.error ?? 'Could not send');
    });
  };
  const now = useNow(serverNow);
  const meIndex = view.players.findIndex((p) => p.playerId === user?.id);
  const me = meIndex >= 0 && view.players[meIndex].status === 'active' ? view.players[meIndex] : null;
  const n = view.players.length;
  const myTurn = !!view.legal && view.currentPlayerId === user?.id;
  const last = view.lastHand;
  const done = view.phase === 'handComplete' || view.phase === 'finished' || view.phase === 'waiting';
  const betting = ['preflop', 'flop', 'turn', 'river'].includes(view.phase);
  const winners = new Set(done ? (last?.pots.flatMap((p) => p.winners) ?? []) : []);
  const t = view.tournament;
  const cash = view.cash ?? null;
  const [sheet, setSheet] = useState<null | 'menu' | 'history' | 'info' | 'settings' | { sit: number }>(null);

  // Auto check / fold: acts for me as soon as it is my turn.
  const [autoCheckFold, setAutoCheckFold] = useState(false);
  useEffect(() => {
    if (!autoCheckFold || !myTurn || pending || !view.legal) return;
    void act({ type: view.legal.canCheck ? 'check' : 'fold' });
    if (!view.legal.canCheck) setAutoCheckFold(false);
  }, [autoCheckFold, myTurn, pending, view.legal, act]);
  useEffect(() => setAutoCheckFold(false), [view.handNumber]);

  // The table fills the space between the top bar and the action strip.
  const [boxRef, box] = useSize<HTMLDivElement>();
  const portrait = box.w < box.h * 1.05 || box.w < 560;
  const TOP = 26; // room above the top seats
  const BOTTOM = 78; // room under my seat for the name box and hand tag
  const SIDE = 48; // side seats hang this far outside the rail
  let railW: number;
  let railH: number;
  if (portrait) {
    railW = Math.max(220, Math.min(box.w - SIDE * 2, box.w * 0.66, 400));
    railH = Math.max(railW * 1.1, Math.min(box.h - TOP - BOTTOM, railW * 1.75));
  } else {
    railH = Math.max(200, Math.min(box.h - TOP - BOTTOM, 420));
    railW = Math.max(railH * 1.25, Math.min(box.w - 150, railH * 2.1, 820));
  }
  const areaW = portrait ? Math.max(railW + SIDE * 2, Math.min(box.w, railW + 140)) : railW + 150;
  const areaH = railH + TOP + BOTTOM;
  const cx = areaW / 2;
  const cy = TOP + railH / 2;
  const RAIL = 13; // dark rail thickness
  const feltW = railW - RAIL * 2;
  const feltH = railH - RAIL * 2;

  // Seats sit on a line just inside the rail's outer edge.
  const pathW = railW - 12;
  const pathH = railH - 12;
  const spotPoint = (s: Spot) => {
    const r = pathW / 2;
    const straight = Math.max(0, pathH - pathW);
    const topC = cy - straight / 2;
    const botC = cy + straight / 2;
    const rad = 'deg' in s ? (s.deg * Math.PI) / 180 : 0;
    if (s.a === 'T') return { x: cx + r * Math.sin(rad), y: topC - r * Math.cos(rad) };
    if (s.a === 'B') return { x: cx + r * Math.sin(rad), y: botC + r * Math.cos(rad) };
    return { x: s.a === 'L' ? cx - r : cx + r, y: topC + ('f' in s ? s.f : 0) * straight };
  };
  // Short portrait table: spread seats evenly round an upright stadium, me at the bottom centre, then clockwise.
  const evenPoint = (k: number, total: number) => {
    const r = pathW / 2;
    const straight = Math.max(0, pathH - pathW);
    const topC = cy - straight / 2;
    const botC = cy + straight / 2;
    const perimeter = 2 * straight + 2 * Math.PI * r;
    let d = (k / total) * perimeter;
    const arc = (ay: number, from: number, len: number) => ({ x: cx + r * Math.cos(from + len / r), y: ay + r * Math.sin(from + len / r) });
    const q = (Math.PI * r) / 2;
    if (d < q) return arc(botC, Math.PI / 2, d);
    d -= q;
    if (d < straight) return { x: cx - r, y: botC - d };
    d -= straight;
    if (d < Math.PI * r) return arc(topC, Math.PI, d);
    d -= Math.PI * r;
    if (d < straight) return { x: cx + r, y: topC + d };
    d -= straight;
    return arc(botC, 0, d);
  };
  // Landscape: spread seats evenly round a flat stadium, me at the bottom centre.
  const flatPoint = (k: number, total: number) => {
    const r = pathH / 2;
    const straight = pathW - pathH;
    const perimeter = 2 * straight + 2 * Math.PI * r;
    let d = (k / total) * perimeter;
    const left = cx - straight / 2;
    const right = cx + straight / 2;
    const arc = (ax: number, from: number, len: number) => ({ x: ax + r * Math.cos(from + len / r), y: cy + r * Math.sin(from + len / r) });
    if (d < straight / 2) return { x: cx - d, y: cy + r };
    d -= straight / 2;
    if (d < Math.PI * r) return arc(left, Math.PI / 2, d);
    d -= Math.PI * r;
    if (d < straight) return { x: left + d, y: cy - r };
    d -= straight;
    if (d < Math.PI * r) return arc(right, -Math.PI / 2, d);
    d -= Math.PI * r;
    return { x: right - d, y: cy + r };
  };

  // Cash tables keep every seat in its place (so empty seats can be taken); other tables space the players evenly.
  const slots = Math.max(1, Math.min(10, cash ? view.config.maxSeats : Math.max(n, 1)));
  const anchor = cash ? (me?.seat ?? 0) : 0;
  const slotOf = (p: PokerPlayerView, i: number) => (cash ? (p.seat - anchor + slots) % slots : (i - Math.max(0, meIndex) + n) % n);
  // Portrait: the hand-placed Stake layout when the table is tall enough, otherwise seats spaced evenly round the rail.
  const tall = pathH - pathW >= pathW * 0.55;
  const baseSeat = (k: number) => (portrait ? (tall ? spotPoint((LAYOUTS[slots] ?? LAYOUTS[10])[k % slots]) : evenPoint(k, slots)) : flatPoint(k, slots));

  // Card sizes: five board cards across most of the felt; my hole cards a touch larger.
  const boardW = Math.round(Math.max(32, Math.min(54, (feltW * 0.82 - 4 * 4) / 5)));
  const holeW = Math.round(Math.min(58, boardW + 4));
  // A seat whose avatar + name box would sit under my face-up cards (right of my seat) moves up out of their way.
  const seatAt = (k: number) => {
    const p = baseSeat(k);
    if (k % slots === 0 || !me) return p;
    const home = baseSeat(0);
    const cardsLeft = home.x + 44;
    const cardsRight = cardsLeft + holeW * 2 + 2;
    const cardsTop = home.y - 12;
    const cardsBottom = cardsTop + holeW * 1.4;
    const overlapsX = p.x + 40 > cardsLeft && p.x - 40 < cardsRight;
    const overlapsY = p.y + 54 > cardsTop && p.y - 24 < cardsBottom;
    return overlapsX && overlapsY ? { x: p.x, y: cardsTop - 58 } : p;
  };

  const ratioFor = (p: PokerPlayerView) => {
    if (p.playerId !== view.currentPlayerId || !view.turnDeadline) return 0;
    return Math.max(0, Math.min(1, (view.turnDeadline - now) / (view.config.turnSeconds * 1000)));
  };
  const secsLeft = view.turnDeadline ? Math.max(0, Math.ceil((view.turnDeadline - now) / 1000)) : 0;
  const labelOf = (id: string) => view.players.find((p) => p.playerId === id)?.handLabel;
  const resultText =
    last && done && view.phase !== 'waiting' && last.handNumber === view.handNumber
      ? last.pots
          .map((pt) => {
            const hand = last.showdown.length ? labelOf(pt.winners[0]) : null;
            return `${pt.winners.map((w) => (w === user?.id ? 'You' : nameOf(state, w))).join(' & ')} won ${fmt(pt.amount)}${hand ? ` · ${hand}` : ''}`;
          })
          .join(' · ')
      : null;

  // A table waiting for players shows an empty board, never the last hand's cards.
  const board = view.phase === 'waiting' ? [] : view.community;

  // Pot: the total (above the board) and the chips already gathered in the middle (below it).
  const bets = view.players.reduce((s, p) => s + p.committed, 0);
  const gathered = Math.max(0, view.pot - bets);

  // The small grey line on the felt, like "Original, 5/10, ante 1 (6)".
  const ante = t?.ante ?? view.config.ante ?? 0;
  const infoLine =
    [t ? (t.name ?? 'Sit & Go') : (cash?.name ?? "Hold'em"), `Blinds ${fmt(view.config.smallBlind)}/${fmt(view.config.bigBlind)}${ante ? ` ante ${fmt(ante)}` : ''}`].join(', ') +
    ` (${view.players.filter((p) => p.status === 'active').length})`;
  const myPlace = t?.myPlace ?? (me ? null : view.players[meIndex]?.place) ?? null;
  const tableTitle = t ? (t.kind === 'mtt' ? `${t.name} · T${t.tableNumber ?? 1}` : 'Sit & Go') : (cash?.name ?? 'Cash game');
  const status =
    view.phase === 'finished'
      ? t ? 'Tournament over' : 'Table closed'
      : !me && cash
        ? 'Watching — tap a free seat to sit down'
        : view.phase === 'waiting'
          ? cash ? 'Waiting for another player to sit down…' : 'Waiting for players…'
          : done
            ? 'Next hand starting…'
            : `${PHASE_LABEL[view.phase]}${view.currentPlayerId ? ` · ${view.currentPlayerId === user?.id ? 'Your turn' : `${nameOf(state, view.currentPlayerId)} to act`}` : ''}`;

  const leave = () => {
    const msg = cash ? 'Stand up and cash out your chips?' : t ? 'Leave the tournament? You forfeit your chips.' : 'Leave the table? You cash out your chips.';
    if (confirm(msg)) void act({ type: 'leave' });
    setSheet(null);
  };

  const mySeat = me ? seatAt(0) : null;
  const showMyCards = me && me.hole.length > 0 && me.inHand && view.phase !== 'waiting';
  // After the hand I can turn one or both of my cards face up (unless they were shown down anyway).
  const shownDown = !!last?.showdown.some((h) => h.playerId === user?.id);
  const canShow = !!showMyCards && (view.phase === 'handComplete' || view.phase === 'finished') && !shownDown;
  const myShown = me?.shown ?? [];
  const show = (cards: number[]) => {
    const fresh = cards.filter((c) => !myShown.includes(c));
    if (fresh.length && !pending) void act({ type: 'show', cards: fresh });
  };

  return (
    <div className="fixed inset-0 z-[35] flex flex-col overflow-hidden text-white" style={{ backgroundColor: '#2a0a10', backgroundImage: `${FLEUR}, radial-gradient(ellipse at center, #4a121c 0%, #2a0a10 75%)` }}>
      {/* Top bar: menu, the table tab (my cards once dealt), a new table, and the trophy panel. */}
      <div className="flex shrink-0 items-center gap-2 px-2 pt-2">
        <RoundButton label="Menu" onClick={() => setSheet('menu')}>
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
            <rect x="3" y="4" width="14" height="2.2" rx="1.1" />
            <rect x="3" y="9" width="14" height="2.2" rx="1.1" />
            <rect x="3" y="14" width="14" height="2.2" rx="1.1" />
          </svg>
        </RoundButton>
        <div className="flex h-9 min-w-[56px] max-w-[46%] items-center justify-center gap-[3px] rounded-full px-3 shadow-[0_3px_8px_rgba(0,0,0,.45)]" style={{ background: '#2f3a46', outline: `1.5px solid ${myTurn ? UI.green : 'transparent'}` }}>
          {showMyCards ? me.hole.map((c) => <TabCard key={c} card={c} />) : <span className="truncate text-xs font-bold">{tableTitle}</span>}
        </div>
        <Link href="/games/poker" aria-label="Lobby — another table" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xl font-bold leading-none shadow-[0_3px_8px_rgba(0,0,0,.45)]" style={{ background: '#2f3a46' }}>
          +
        </Link>
        <div className="ml-auto">
          <RoundButton label={t ? 'Tournament info' : 'Table info'} onClick={() => setSheet('info')}>
            <TrophyIcon />
          </RoundButton>
        </div>
      </div>
      <div className="mt-1.5 shrink-0 px-2">
        <span className="rounded-md bg-black/35 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white/70">#{state.matchId.replace(/-/g, '').slice(0, 9).toUpperCase()}</span>
      </div>

      <div ref={boxRef} className="relative min-h-0 w-full flex-1">
        <div className="absolute left-1/2 top-1/2" style={{ width: areaW, height: areaH, transform: 'translate(-50%, -50%)' }}>
          {/* The table: a dark rail, a thin gold line and a blue felt; straight sides and round ends. */}
          <div
            className="absolute"
            style={{
              left: cx - railW / 2,
              top: cy - railH / 2,
              width: railW,
              height: railH,
              borderRadius: Math.min(railW, railH) / 2,
              background: 'linear-gradient(180deg,#454a52 0%,#30343a 45%,#23262b 100%)',
              boxShadow: '0 24px 50px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.12), inset 0 -2px 6px rgba(0,0,0,.5)',
            }}
          />
          <div
            className="absolute overflow-hidden"
            style={{
              left: cx - feltW / 2,
              top: cy - feltH / 2,
              width: feltW,
              height: feltH,
              borderRadius: Math.min(feltW, feltH) / 2,
              border: '2.5px solid #e2a83a',
              boxShadow: 'inset 0 0 50px rgba(0,0,0,.35), 0 0 0 2px rgba(0,0,0,.35)',
              background: 'radial-gradient(ellipse at center, #3a8be0 0%, #2a74cc 45%, #1f5fae 100%)',
            }}
          >
            <div className="absolute inset-0 grid place-items-center">
              <span className="select-none font-display font-black italic tracking-tight text-white/[0.14]" style={{ fontSize: Math.round(Math.min(feltW, feltH) / 4) }}>
                Akukulu
              </span>
            </div>
          </div>

          {/* Middle: the pot, the board, the gathered chips and the info line. */}
          {/* The board itself sits on the table's centre line; the pot is above it, chips and info below. */}
          <div className="absolute flex flex-col items-center" style={{ left: cx, top: cy - 32 - (boardW * 1.4) / 2, width: feltW * 0.92, transform: 'translateX(-50%)' }}>
            <div className="mb-2 flex h-6 items-center">
              {view.pot > 0 && <span className="rounded-full bg-black/25 px-2.5 py-0.5 text-[12px] font-semibold tabular-nums text-white">Pot: {fmt(view.pot)}</span>}
            </div>
            <div className="flex gap-[5px]">
              {board.map((c, i) => (
                <TableCard key={c} card={c} width={boardW} delay={i * 90} highlight={done && !!last?.showdown.some((s) => s.best.includes(c))} />
              ))}
              {board.length === 0 &&
                Array.from({ length: 5 }, (_, i) => <div key={i} className="rounded-[6px] border border-white/10 bg-white/[0.04]" style={{ width: boardW, height: boardW * 1.4 }} />)}
            </div>
            <div className="mt-2 flex h-7 items-center">{gathered > 0 && <Chips amount={gathered} big />}</div>
            {(view.phase === 'waiting' || (!me && cash) || view.phase === 'finished') && (
              <div className="mt-1 max-w-full truncate rounded-full bg-black/40 px-3 py-1 text-center text-[11px] font-semibold text-white/85">{status}</div>
            )}
            {resultText && <div className="mt-1 max-w-full truncate rounded-full bg-black/50 px-3 py-1 text-center text-[11px] font-bold" style={{ color: UI.gold }}>{resultText}</div>}
            <div className="mt-1.5 max-w-full truncate text-center text-[11px] font-medium text-white/45">{infoLine}</div>
          </div>

          {/* Free seats at a cash table: tap to sit down. */}
          {cash &&
            cash.freeSeats.map((seat) => {
              const { x, y } = seatAt((seat - anchor + slots) % slots);
              return (
                <div key={`free${seat}`} className="absolute" style={{ left: x, top: y, transform: 'translate(-50%, -50%)', zIndex: 5 }}>
                  {me ? (
                    <div className="h-10 w-10 rounded-full bg-[#2b3038]/60 ring-1 ring-black/30" />
                  ) : (
                    <button aria-label={`Sit in seat ${seat + 1}`} className="grid h-11 w-11 place-items-center rounded-full text-white shadow-[0_4px_10px_rgba(0,0,0,.5)] ring-1 ring-black/40 active:scale-95" style={{ background: '#3a4552' }} onClick={() => setSheet({ sit: seat })}>
                      <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 3.5v9M6 9l4 4 4-4M5 16.5h10" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}

          {/* Seats, their bets in front of them, and the dealer button. */}
          {view.players.map((p, i) => {
            const { x, y } = seatAt(slotOf(p, i));
            const info = state.players.find((x2) => x2.userId === p.playerId);
            const isMe = p.playerId === user?.id;
            // Bets sit just inside the felt in front of the seat.
            // Aim bets and the dealer button above or below the board rather than at it.
            const aimY = y < cy - 30 ? cy - boardW * 1.4 - 40 : y > cy + 30 ? cy + boardW * 1.4 + 20 : cy;
            const dx = cx - x;
            const dy = aimY - y;
            const dist = Math.hypot(dx, dy) || 1;
            const inward = (px: number) => ({ left: x + (dx / dist) * px, top: y + (dy / dist) * px });
            return (
              <div key={p.playerId}>
                <div className="absolute" style={{ left: x, top: y, transform: 'translate(-50%, -24px)', zIndex: isMe ? 6 : 5 }}>
                  <Seat
                    p={p}
                    name={info?.displayName ?? 'Player'}
                    photoUrl={info?.photoUrl}
                    you={isMe}
                    turn={p.playerId === view.currentPlayerId && !done}
                    winner={winners.has(p.playerId)}
                    ratio={ratioFor(p)}
                    secs={secsLeft}
                    tournament={!!t}
                    waiting={betting && p.status === 'active' && !p.inHand}
                    cardW={boardW}
                    onAvatar={me && p.status === 'active' ? () => setPicker({ to: isMe ? null : p.playerId }) : undefined}
                  />
                </div>
                {p.committed > 0 && (
                  <div className="absolute" style={{ ...inward(Math.min(dist - 10, 52 + 34 * Math.max(0, dy / dist) + 24 * (Math.abs(dx) / dist))), transform: 'translate(-50%, -50%)', zIndex: 4 }}>
                    <Chips amount={p.committed} />
                  </div>
                )}
                {p.isButton && (
                  <div
                    className="absolute grid h-[22px] w-[22px] place-items-center rounded-full bg-white text-[11px] font-black text-[#1a2c38] shadow-[0_2px_4px_rgba(0,0,0,.5)] ring-1 ring-black/20"
                    style={{
                      left: x + (dx / dist) * (46 + 28 * Math.max(0, dy / dist) + 14 * (Math.abs(dx) / dist)) + (dy / dist) * 30,
                      top: y + (dy / dist) * (46 + 28 * Math.max(0, dy / dist) + 14 * (Math.abs(dx) / dist)) - (dx / dist) * 30,
                      transform: 'translate(-50%, -50%)',
                      zIndex: 4,
                    }}
                  >
                    D
                  </div>
                )}
              </div>
            );
          })}

          {/* My two cards face up, right of my avatar on the rail, with my hand under my name. */}
          {showMyCards && mySeat && (
            <div className="absolute" style={{ left: mySeat.x + 44, top: mySeat.y - 10, zIndex: 7 }}>
              {canShow && (
                <div className="absolute bottom-[calc(100%+4px)] left-0 flex w-max gap-1">
                  {myShown.length < me.hole.length ? (
                    <button
                      className="rounded-[5px] px-2 py-[3px] text-[11px] font-extrabold shadow-[0_2px_6px_rgba(0,0,0,.45)] active:scale-95"
                      style={{ background: UI.green, color: '#05140a' }}
                      onClick={() => show(me.hole.map((_, i) => i))}
                    >
                      Show {myShown.length ? 'other' : 'both'}
                    </button>
                  ) : (
                    <span className="rounded-[5px] bg-black/55 px-2 py-[3px] text-[11px] font-bold text-white/85">Shown to the table</span>
                  )}
                </div>
              )}
              <div className="flex gap-[2px]">
                {me.hole.map((c, i) => {
                  const shown = myShown.includes(i);
                  return (
                    <button
                      key={c}
                      className={`relative block ${canShow && !shown ? 'cursor-pointer active:scale-95' : 'cursor-default'}`}
                      onClick={canShow && !shown ? () => show([i]) : undefined}
                      aria-label={canShow && !shown ? 'Show this card' : undefined}
                      disabled={!canShow || shown}
                    >
                      <TableCard card={c} width={holeW} delay={i * 120} dim={me.folded && !shown} highlight={done && !!last?.showdown.some((s) => s.playerId === me.playerId && s.best.includes(c))} />
                      {canShow && (
                        <span
                          className="absolute -right-1 -top-1 grid h-[18px] w-[18px] place-items-center rounded-full text-[10px] shadow"
                          style={{ background: shown ? UI.green : 'rgba(15,33,46,.9)', color: shown ? '#05140a' : '#fff', border: '1px solid rgba(255,255,255,.35)' }}
                          aria-hidden
                        >
                          <EyeIcon open={shown} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Reactions: emoji pops over the sender, throwables fly between seats. */}
          {reactions.map((r) => {
            const pos = (id: string) => {
              const i = view.players.findIndex((p) => p.playerId === id);
              return i < 0 ? null : seatAt(slotOf(view.players[i], i));
            };
            const from = pos(r.from);
            if (!from) return null;
            if (!r.to) return <EmojiPop key={r.id} x={from.x} y={from.y} emoji={r.emoji} />;
            const to = pos(r.to);
            return to ? <Throwable key={r.id} from={from} to={to} emoji={r.emoji} /> : null;
          })}
          {reactionNote && (
            <div className="pointer-events-none absolute z-[31] rounded-full bg-black/70 px-3 py-1 text-[11px] font-bold text-white" style={{ left: cx, top: cy + feltH * 0.3, transform: 'translate(-50%, -50%)' }}>
              {reactionNote}
            </div>
          )}
        </div>
      </div>

      {/* Bottom strip: history and settings in the corners; my actions (or the state of play) between. */}
      <div className="relative mx-auto flex w-full max-w-[640px] shrink-0 items-end gap-2 px-2 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-1">
        {me ? (
          <RoundButton label="Emoji reactions" size={44} onClick={() => setPicker({ to: null })}>
            <svg viewBox="0 0 22 22" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M11 2.8c4.8 0 8.4 3.2 8.4 7.3s-3.6 7.3-8.4 7.3c-1 0-2-.1-2.9-.4L4 19l1-3.6c-1.5-1.3-2.4-3.2-2.4-5.3 0-4.1 3.6-7.3 8.4-7.3z" />
              <circle cx="8" cy="9" r=".6" fill="currentColor" />
              <circle cx="14" cy="9" r=".6" fill="currentColor" />
              <path d="M7.8 12c.8 1 1.9 1.5 3.2 1.5s2.4-.5 3.2-1.5" />
            </svg>
          </RoundButton>
        ) : (
          <RoundButton label="Hand history" size={44} onClick={() => setSheet('history')}>
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3.5 10a6.5 6.5 0 1 0 2-4.7" strokeLinecap="round" />
              <path d="M3 3.5v3h3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M10 6.5V10l2.5 1.6" strokeLinecap="round" />
            </svg>
          </RoundButton>
        )}
        <div className="flex min-h-[44px] min-w-0 flex-1 items-center justify-center">
          {myPlace != null && t ? (
            <div className="truncate rounded-full px-3 py-2 text-center text-[13px] font-black" style={{ background: 'rgba(245,182,35,.15)', color: UI.gold }}>
              You finished {ordinal(myPlace)}
              {t.payouts[myPlace - 1] ? ` — prize ${fmt(t.payouts[myPlace - 1])}` : ''}
            </div>
          ) : myTurn && view.legal ? (
            <ActionBar view={view} act={act} pending={pending} />
          ) : me && me.inHand && !me.folded && !done ? (
            <button
              className="flex h-10 items-center gap-2 rounded-[6px] px-3 text-[12px] font-bold"
              style={{ background: autoCheckFold ? '#1475e1' : 'rgba(26,44,56,.92)', color: '#fff', border: `1px solid ${UI.line}` }}
              onClick={() => setAutoCheckFold((v) => !v)}
              aria-pressed={autoCheckFold}
            >
              <span className="grid h-4 w-4 place-items-center rounded-[3px] border border-white/60 text-[10px]">{autoCheckFold ? '✓' : ''}</span>
              Check / Fold
            </button>
          ) : me && !done && view.phase !== 'finished' ? (
            <span className="truncate text-[12px] font-semibold text-white/60">{status}</span>
          ) : null}
        </div>
        <RoundButton label="Auto check / fold and settings" size={44} onClick={() => setSheet('settings')}>
          <svg viewBox="0 0 22 22" className="h-6 w-6">
            <circle cx="11" cy="11" r="9" fill="#fff" />
            <path d="M6.8 11.3l2.8 2.8 5.6-5.8" fill="none" stroke="#2f3a46" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </RoundButton>
      </div>

      {picker && (
        <ReactionPicker
          title={picker.to ? `Throw something at ${nameOf(state, picker.to)}` : 'Send an emoji to the table'}
          items={picker.to ? POKER_THROWABLES : POKER_EMOJIS}
          onPick={(e) => sendReaction(e, picker.to)}
          onClose={() => setPicker(null)}
        />
      )}
      {sheet === 'menu' && (
        <Sheet title="Menu" onClose={() => setSheet(null)}>
          <div className="grid gap-2 text-sm font-bold">
            <Link href="/games/poker" className="rounded-lg px-4 py-3" style={{ background: UI.bg2 }}>
              Back to the lobby
            </Link>
            <button className="rounded-lg px-4 py-3 text-left" style={{ background: UI.bg2 }} onClick={() => setSheet('info')}>
              {t ? 'Tournament info' : 'Table info'}
            </button>
            <button className="rounded-lg px-4 py-3 text-left" style={{ background: UI.bg2 }} onClick={() => setSheet('history')}>
              Hand history
            </button>
            {me && view.phase !== 'finished' && (
              <button className="rounded-lg bg-danger/20 px-4 py-3 text-left text-danger" onClick={leave}>
                {cash ? 'Stand up and cash out' : t ? 'Leave the tournament' : 'Leave the table'}
              </button>
            )}
          </div>
        </Sheet>
      )}
      {sheet === 'history' && (
        <Sheet title="Hand history" onClose={() => setSheet(null)}>
          <HandHistoryList matchId={state.matchId} empty="No hands at this table yet." />
        </Sheet>
      )}
      {sheet === 'info' && <InfoDrawer view={view} state={state} now={now} meId={user?.id} onClose={() => setSheet(null)} />}
      {sheet === 'settings' && (
        <Sheet title="Settings" onClose={() => setSheet(null)}>
          <div className="grid gap-2 text-sm font-bold">
            <label className="flex items-center justify-between rounded-lg px-4 py-3" style={{ background: UI.bg2 }}>
              Auto check / fold this hand
              <input type="checkbox" checked={autoCheckFold} onChange={(e) => setAutoCheckFold(e.target.checked)} className="h-5 w-5 accent-[#00e701]" disabled={!me?.inHand || me.folded} />
            </label>
            {me && view.phase !== 'finished' && (
              <button className="rounded-lg bg-danger/20 px-4 py-3 text-left text-danger" onClick={leave}>
                {cash ? 'Stand up and cash out' : t ? 'Leave the tournament' : 'Leave the table'}
              </button>
            )}
          </div>
        </Sheet>
      )}
      {sheet !== null && typeof sheet === 'object' && cash && (
        <Sheet title={`Sit down · ${cash.name ?? 'Cash table'}`} onClose={() => setSheet(null)}>
          <SitDown matchId={state.matchId} seat={sheet.sit} cash={cash} onDone={() => setSheet(null)} />
        </Sheet>
      )}
    </div>
  );
}

