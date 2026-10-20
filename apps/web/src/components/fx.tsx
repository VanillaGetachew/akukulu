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

/**
 * Start-of-round animation: the deck is riffle-shuffled, then cards fly out to
 * the opponent (top) and the player (bottom). Calls `onDone` when finished.
 */
export function ShuffleAndDeal({ onDone, cardsEach = 7 }: { onDone: () => void; cardsEach?: number }) {
  const SHUFFLE_MS = 1300;
  const DEAL_STEP_MS = 90;
  const total = cardsEach * 2;
  useEffect(() => {
    const t = setTimeout(onDone, SHUFFLE_MS + total * DEAL_STEP_MS + 700);
    return () => clearTimeout(t);
  }, [onDone, total]);
  return (
    <div className="pointer-events-none absolute inset-0 z-[39]" aria-hidden="true">
      <div className="absolute inset-0 bg-black/25" style={{ animation: `fx-fade-out ${(SHUFFLE_MS + total * DEAL_STEP_MS + 700) / 1000}s both` }} />
      {/* Riffle shuffle: two half-decks sweep together twice. */}
      {Array.from({ length: 6 }, (_, i) => (
        <div key={`l${i}`} className="absolute left-1/2 top-1/2" style={{ animation: `fx-riffle-left ${SHUFFLE_MS / 2000}s ease-in-out ${i * 0.03}s 2 both`, marginTop: -i * 1.5 }}>
          <PlayingCard card="??" />
        </div>
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <div key={`r${i}`} className="absolute left-1/2 top-1/2" style={{ animation: `fx-riffle-right ${SHUFFLE_MS / 2000}s ease-in-out ${i * 0.03 + 0.015}s 2 both`, marginTop: -i * 1.5 }}>
          <PlayingCard card="??" />
        </div>
      ))}
      {/* Deal: alternate cards to the opponent (top) and to you (bottom). */}
      {Array.from({ length: total }, (_, i) => {
        const toMe = i % 2 === 0;
        const spread = ((i >> 1) - (cardsEach - 1) / 2) * 22;
        return (
          <div
            key={`d${i}`}
            className="absolute left-1/2 top-1/2 opacity-0"
            style={
              {
                animation: `fx-deal .5s cubic-bezier(.2,.8,.2,1) ${(SHUFFLE_MS + i * DEAL_STEP_MS) / 1000}s both`,
                '--tx': `${spread}px`,
                '--ty': toMe ? '38vh' : '-38vh',
                '--rot': `${spread / 6}deg`,
              } as React.CSSProperties
            }
          >
            <PlayingCard card="??" />
          </div>
        );
      })}
      <div className="absolute inset-x-0 top-[58%] text-center font-ethiopic text-sm font-bold text-white drop-shadow" style={{ animation: `fx-fade-out ${(SHUFFLE_MS + total * DEAL_STEP_MS + 700) / 1000}s both` }}>
        ካርታ እየተቀላቀለ ነው… · Shuffling and dealing
      </div>
    </div>
  );
}
