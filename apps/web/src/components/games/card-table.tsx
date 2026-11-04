'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card } from '@akukulu/shared';
import { CardBack, CardFace } from '@/components/card-face';

/* Pieces shared by the card tables (Conquer, Crazy): screen-size hooks, the 3D deck, the tossed discard pile and the action buttons. */

/** Tracks an element's width; the callback ref re-attaches whenever the element mounts. */
export function useWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(360);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    observer.current = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    observer.current.observe(el);
  }, []);
  return [ref, width] as const;
}

/** Tracks the window height, so the hand and table shrink on short screens instead of scrolling. */
export function useViewportHeight() {
  const [h, setH] = useState(700);
  useEffect(() => {
    const update = () => setH(window.visualViewport?.height ?? window.innerHeight);
    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);
  return h;
}

/** The deck as a 3D block: card edges stacked below the top back, thicker while it holds more cards. */
export function DeckStack({ count, active }: { count: number; active: boolean }) {
  const w = 52;
  const h = Math.round(w * 1.4);
  const layers = Math.max(1, Math.min(7, Math.ceil(count / 4)));
  return (
    <div className="relative" style={{ width: w + 4, height: h + layers * 2 + 4 }}>
      {Array.from({ length: layers }, (_, i) => (
        <div
          key={i}
          className="absolute rounded-[8px] border border-[#c9c3b3] bg-[#f4f1e8]"
          style={{ width: w, height: h, top: (layers - i) * 2, left: (layers - i) * 0.6, boxShadow: i === 0 ? '0 6px 10px rgba(0,0,0,.45)' : undefined }}
        />
      ))}
      <div className={`absolute left-0 top-0 rounded-[8px] ${active ? 'animate-pulseRing' : ''}`} style={{ width: w, height: h }}>
        <CardBack width={w} />
        <span className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 text-[10px] font-bold">{count}</span>
      </div>
    </div>
  );
}
/** Deterministic "random" tilt and offset per card, so the pile looks tossed but does not jitter between renders. */
function toss(card: Card, i: number) {
  let h = i * 7919;
  for (const ch of card) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const r = (k: number) => (((h >> k) & 0xff) / 255) * 2 - 1;
  return { rot: r(0) * 24, x: r(8) * 7, y: r(16) * 5 };
}

/** The discard pile: the last few cards thrown at angles, the top one fully visible. */
export function DiscardPile({ cards, count, active }: { cards: Card[]; count: number; active: boolean }) {
  const w = 52;
  const h = Math.round(w * 1.4);
  const hidden = Math.max(0, count - cards.length);
  return (
    <div className="relative" style={{ width: w + 16, height: h + 12 }}>
      {hidden > 0 && <div className="absolute left-2 top-1.5 rounded-lg bg-white/25" style={{ width: w, height: h, transform: 'rotate(-8deg)' }} />}
      {cards.length === 0 && <div className="absolute left-2 top-1.5 rounded-lg bg-white/10" style={{ width: w, height: h }} />}
      {cards.map((c, i) => {
        const top = i === cards.length - 1;
        const t = toss(c, count - cards.length + i);
        return (
          <div
            key={`${c}-${i}`}
            className={`absolute left-2 top-1.5 rounded-[8px] shadow-[0_2px_5px_rgba(0,0,0,.45)] ${top && active ? 'outline outline-2 outline-gold' : ''}`}
            style={{ transform: `translate(${t.x}px, ${t.y}px) rotate(${top ? t.rot * 0.35 : t.rot}deg)`, zIndex: i }}
          >
            <CardFace card={c} width={w} />
          </div>
        );
      })}
    </div>
  );
}

export function ActionButton({ am, en, onClick, disabled, tone = 'teal' }: { am: string; en: string; onClick: () => void; disabled?: boolean; tone?: 'teal' | 'gold' | 'red' }) {
  // Emerald for the main moves, gold for joker moves, red for giving up; all on dark glass over the felt.
  const tones = {
    teal: 'bg-[#06241a]/85 border-lime/35 hover:border-lime/60 enabled:shadow-[inset_0_1px_0_rgba(255,255,255,.06)]',
    gold: 'bg-[#2a210c]/85 border-gold/40 hover:border-gold/70',
    red: 'bg-[#2c0f15]/85 border-danger/45 hover:border-danger/70',
  };
  const ink = { teal: 'text-[#d9fbe9]', gold: 'text-[#f6e6bd]', red: 'text-[#ffd3db]' };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-[48px] min-w-0 flex-col items-center justify-center rounded-xl border px-1 py-1 backdrop-blur-sm transition duration-150 active:scale-95 disabled:opacity-30 disabled:active:scale-100 ${tones[tone]} ${ink[tone]}`}
    >
      <span className="max-w-full truncate font-ethiopic text-[14px] font-bold leading-tight">{am}</span>
      <span className="max-w-full truncate text-[10px] font-semibold text-white/60">{en}</span>
    </button>
  );
}
