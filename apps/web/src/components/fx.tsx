'use client';

import { useEffect, useMemo } from 'react';
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
export const DEAL_TIMING = { shuffleMs: 1300, stepMs: 110, flightMs: 450 };

/** Cards that have landed `elapsed` ms after the deal started. */
export const dealtCount = (elapsed: number, total: number) =>
  Math.max(0, Math.min(total, Math.floor((elapsed - DEAL_TIMING.shuffleMs - DEAL_TIMING.flightMs) / DEAL_TIMING.stepMs) + 1));

/**
 * Start-of-round animation: the deck is riffle-shuffled, then cards fly out one
 * at a time to the opponent (top) and the player (bottom), in `sequence` order.
 * Calls `onDone` when the last card has landed.
 */
export function ShuffleAndDeal({ onDone, sequence }: { onDone: () => void; sequence: ('me' | 'opp')[] }) {
  const { shuffleMs, stepMs, flightMs } = DEAL_TIMING;
  const total = sequence.length;
  const doneMs = shuffleMs + Math.max(0, total - 1) * stepMs + flightMs + 150;
  useEffect(() => {
    const t = setTimeout(onDone, doneMs);
    return () => clearTimeout(t);
  }, [onDone, doneMs]);
  const counts = { me: sequence.filter((x) => x === 'me').length, opp: sequence.filter((x) => x === 'opp').length };
  const seen = { me: 0, opp: 0 };
  return (
    <div className="pointer-events-none absolute inset-0 z-[39]" aria-hidden="true">
      {/* Riffle shuffle: two half-decks sweep together twice. */}
      {Array.from({ length: 6 }, (_, i) => (
        <div key={`l${i}`} className="absolute left-1/2 top-1/2" style={{ animation: `fx-riffle-left ${shuffleMs / 2000}s ease-in-out ${i * 0.03}s 2 both`, marginTop: -i * 1.5 }}>
          <PlayingCard card="??" />
        </div>
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <div key={`r${i}`} className="absolute left-1/2 top-1/2" style={{ animation: `fx-riffle-right ${shuffleMs / 2000}s ease-in-out ${i * 0.03 + 0.015}s 2 both`, marginTop: -i * 1.5 }}>
          <PlayingCard card="??" />
        </div>
      ))}
      {/* The rest of the deck waits in the middle while the cards go out. */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ animation: `fx-deck-wait ${doneMs / 1000}s both` }}>
        <PlayingCard card="??" />
      </div>
      {sequence.map((to, i) => {
        const k = seen[to]++;
        const spread = (k - (counts[to] - 1) / 2) * (to === 'me' ? 20 : 14);
        return (
          <div
            key={`d${i}`}
            className="absolute left-1/2 top-1/2 opacity-0"
            style={
              {
                animation: `fx-deal ${flightMs / 1000}s cubic-bezier(.2,.8,.2,1) ${(shuffleMs + i * stepMs) / 1000}s both`,
                '--tx': `${spread}px`,
                '--ty': to === 'me' ? '36vh' : '-40vh',
                '--rot': `${spread / 8}deg`,
              } as React.CSSProperties
            }
          >
            <PlayingCard card="??" />
          </div>
        );
      })}
    </div>
  );
}