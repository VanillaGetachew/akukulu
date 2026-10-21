'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PlayingCard } from '@/components/ui';

const RAIN_FACES = ['As', 'Kh', 'Qd', 'Jc', 'Ah', 'Ks', 'Qc', 'Jd', 'Ts', '7h', 'X1', 'Ad'];

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
export const DEAL_TIMING = { shuffleMs: 1100, stepMs: 120, flightMs: 520 };

/** Cards that have landed `elapsed` ms after the deal started. */
export const dealtCount = (elapsed: number, total: number) =>
  Math.max(0, Math.min(total, Math.floor((elapsed - DEAL_TIMING.shuffleMs - DEAL_TIMING.flightMs) / DEAL_TIMING.stepMs) + 1));

interface Box {
  x: number;
  y: number;
  w: number;
}

/**
 * Start-of-round animation: the deck is riffle-shuffled where it sits on the table,
 * then cards fly out one at a time, in an arc, to their place in the player's fan
 * (bottom) or the opponents' (top), in `sequence` order. Calls `onDone` once the last
 * card has landed.
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
  const at = (b: Box) => ({ left: b.x, top: b.y });
  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-[39]" aria-hidden="true">
      {boxes && (
        <>
          {/* Riffle shuffle on the deck: two half-decks sweep together twice. */}
          {Array.from({ length: 5 }, (_, i) => (
            <div key={`l${i}`} className="absolute" style={{ ...at(boxes.deck), animation: `fx-riffle-left ${shuffleMs / 2000}s ease-in-out ${i * 0.03}s 2 both`, marginTop: -i * 1.5 }}>
              <PlayingCard card="??" />
            </div>
          ))}
          {Array.from({ length: 5 }, (_, i) => (
            <div key={`r${i}`} className="absolute" style={{ ...at(boxes.deck), animation: `fx-riffle-right ${shuffleMs / 2000}s ease-in-out ${i * 0.03 + 0.015}s 2 both`, marginTop: -i * 1.5 }}>
              <PlayingCard card="??" />
            </div>
          ))}
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
                    animation: `fx-deal-fly ${flightMs / 1000}s cubic-bezier(.25,.75,.3,1) ${(shuffleMs + i * stepMs) / 1000}s both`,
                    '--x0': `${boxes.deck.x}px`,
                    '--y0': `${boxes.deck.y}px`,
                    '--x1': `${target.x + offset}px`,
                    '--y1': `${target.y}px`,
                    '--rot': `${(k - (n - 1) / 2) * (to === 'me' ? 3 : -3) + (to === 'me' ? 360 : -360)}deg`,
                    '--s1': to === 'me' ? '1.05' : '0.7',
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