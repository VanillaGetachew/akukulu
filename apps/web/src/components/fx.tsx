'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PlayingCard } from '@/components/ui';

const RAIN_FACES = ['As', 'Kh', 'Qd', 'Jc', 'Ah', 'Ks', 'Qc', 'Jd', 'Ts', '7h', 'X1', 'Ad'];
const CONFETTI = ['#e53935', '#2e9e48', '#f6b80e', '#1f7fdc', '#ffffff', '#ff7ab6'];

/**
 * The Ludo winner's celebration: a golden trophy pops up while confetti in the four
 * board colours bursts out and drifts down. Purely decorative and click-through.
 */
export function LudoWin({ count = 90 }: { count?: number }) {
  const bits = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        color: CONFETTI[i % CONFETTI.length],
        left: Math.random() * 100,
        delay: Math.random() * 1.6,
        duration: 2.4 + Math.random() * 2.2,
        r0: Math.random() * 360,
        r1: Math.random() * 1080 - 540,
        drift: Math.random() * 160 - 80,
        w: 6 + Math.random() * 6,
        round: i % 5 === 0,
      })),
    [count],
  );
  return (
    <div className="pointer-events-none fixed inset-0 z-[45] overflow-hidden" aria-hidden="true">
      {bits.map((b, i) => (
        <div
          key={i}
          className="absolute top-0"
          style={
            {
              left: `${b.left}%`,
              animation: `fx-fall ${b.duration}s cubic-bezier(.3,.1,.6,1) ${b.delay}s both`,
              '--r0': `${b.r0}deg`,
              '--r1': `${b.r1}deg`,
              '--drift': `${b.drift}px`,
            } as React.CSSProperties
          }
        >
          <div style={{ width: b.w, height: b.round ? b.w : b.w * 0.45, background: b.color, borderRadius: b.round ? '50%' : 2 }} />
        </div>
      ))}
      <div className="absolute inset-x-0 top-[12%] flex justify-center">
        <svg viewBox="0 0 100 100" className="h-28 w-28 drop-shadow-[0_6px_14px_rgba(0,0,0,.45)]" style={{ animation: 'fx-trophy 1.2s cubic-bezier(.2,.9,.3,1.4) both' }}>
          <defs>
            <linearGradient id="trophy-gold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff3b0" />
              <stop offset="0.45" stopColor="#f6c431" />
              <stop offset="1" stopColor="#b9790a" />
            </linearGradient>
          </defs>
          <path d="M28 14 h44 v14 c0 18 -10 30 -22 32 c-12 -2 -22 -14 -22 -32 z" fill="url(#trophy-gold)" stroke="#8a5a00" strokeWidth="2" />
          <path d="M28 20 h-12 c0 14 8 20 14 20 M72 20 h12 c0 14 -8 20 -14 20" fill="none" stroke="#c98d10" strokeWidth="5" strokeLinecap="round" />
          <rect x="44" y="60" width="12" height="12" fill="#d9a21b" />
          <rect x="32" y="72" width="36" height="10" rx="3" fill="url(#trophy-gold)" stroke="#8a5a00" strokeWidth="2" />
          <path d="M50 22 l4 8 9 1 -7 6 2 9 -8 -5 -8 5 2 -9 -7 -6 9 -1 z" fill="#fff8d8" />
        </svg>
      </div>
    </div>
  );
}

/** Cards falling from the sky — shown to the winner. Purely decorative and click-through. */
export function CardRain({ count = 28 }: { count?: number }) {
  const cards = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        face: RAIN_FACES[i % RAIN_FACES.length],
        left: Math.random() * 100,
        delay: Math.random() * 2.2,
        duration: 2.6 + Math.random() * 2,
        r0: Math.random() * 360 - 180,
        r1: Math.random() * 720 - 360,
        drift: Math.random() * 120 - 60,
        scale: 0.7 + Math.random() * 0.5,
      })),
    [count],
  );
  return (
    <div className="pointer-events-none fixed inset-0 z-[45] overflow-hidden" aria-hidden="true">
      {cards.map((c, i) => (
        <div
          key={i}
          className="absolute top-0"
          style={
            {
              left: `${c.left}%`,
              animation: `fx-fall ${c.duration}s cubic-bezier(.3,.1,.6,1) ${c.delay}s both`,
              '--r0': `${c.r0}deg`,
              '--r1': `${c.r1}deg`,
              '--drift': `${c.drift}px`,
            } as React.CSSProperties
          }
        >
          <div style={{ transform: `scale(${c.scale})` }}>
            <PlayingCard card={c.face} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Timing of the deal, so a table can reveal each card as it lands. */
export const DEAL_TIMING = { shuffleMs: 250, stepMs: 110, flightMs: 420 };

/** Cards that have landed `elapsed` ms after the deal started. */
export const dealtCount = (elapsed: number, total: number) =>
  Math.max(0, Math.min(total, Math.floor((elapsed - DEAL_TIMING.shuffleMs - DEAL_TIMING.flightMs) / DEAL_TIMING.stepMs) + 1));

interface Box {
  x: number;
  y: number;
  w: number;
}

/**
 * Start-of-round animation: cards slide off the table's one deck, one at a time, to
 * their place in the player's fan (bottom) or the opponents' (top), in `sequence`
 * order. Calls `onDone` once the last card has landed.
 *
 * Positions come from elements the table marks with `data-deal="deck" | "me" | "opp"`;
 * without them it falls back to the middle, bottom and top of the screen.
 */
export function ShuffleAndDeal({ onDone, sequence }: { onDone: () => void; sequence: ('me' | 'opp')[] }) {
  const { shuffleMs, stepMs, flightMs } = DEAL_TIMING;
  const total = sequence.length;
  const doneMs = shuffleMs + Math.max(0, total - 1) * stepMs + flightMs + 120;
  const root = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<{ deck: Box; me: Box; opp: Box } | null>(null);
  useEffect(() => {
    const t = setTimeout(onDone, doneMs);
    return () => clearTimeout(t);
  }, [onDone, doneMs]);
  useLayoutEffect(() => {
    const el = root.current;
    const table = el?.parentElement;
    if (!el || !table) return;
    const base = el.getBoundingClientRect();
    const box = (name: string, fallback: Box): Box => {
      const target = table.querySelector<HTMLElement>(`[data-deal="${name}"]`);
      if (!target) return fallback;
      const r = target.getBoundingClientRect();
      return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2, w: r.width };
    };
    const W = base.width;
    const H = base.height;
    setBoxes({ deck: box('deck', { x: W / 2, y: H / 2, w: 60 }), me: box('me', { x: W / 2, y: H - 90, w: W * 0.8 }), opp: box('opp', { x: W / 2, y: 70, w: W * 0.6 }) });
  }, []);

  const counts = { me: sequence.filter((x) => x === 'me').length, opp: sequence.filter((x) => x === 'opp').length };
  const seen = { me: 0, opp: 0 };
  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-[39]" aria-hidden="true">
      {boxes && (
        <>
          {sequence.map((to, i) => {
            const k = seen[to]++;
            const n = counts[to];
            const target = boxes[to];
            // Land where the card will sit in that fan.
            const step = n > 1 ? Math.min(to === 'me' ? 34 : 16, (target.w - 50) / (n - 1)) : 0;
            const offset = (k - (n - 1) / 2) * step;
            return (
              <div
                key={`d${i}`}
                className="absolute left-0 top-0 opacity-0"
                style={
                  {
                    animation: `fx-deal-fly ${flightMs / 1000}s ease-out ${(shuffleMs + i * stepMs) / 1000}s both`,
                    '--x0': `${boxes.deck.x}px`,
                    '--y0': `${boxes.deck.y}px`,
                    '--x1': `${target.x + offset}px`,
                    '--y1': `${target.y}px`,
                    // Just the small tilt the card has in the fan; no spin.
                    '--rot': `${(k - (n - 1) / 2) * (to === 'me' ? 2 : -2)}deg`,
                    '--s1': to === 'me' ? '1' : '0.7',
                  } as React.CSSProperties
                }
              >
                <PlayingCard card="??" />
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}