'use client';

import { useId } from 'react';
import { RANK_LABEL, isPrintedJoker, type Card, type Rank, type Suit } from '@akukulu/shared';

/*
 * The Akukulu deck. Every card is drawn on a 100 × 140 canvas and scaled to any width.
 * Ivory faces, vector suits (no emoji or font glyphs, so they look the same on every phone),
 * real pip layouts on number cards, framed court cards with a gold mark, and a navy back
 * woven with the gold tibeb lattice.
 */

const RED = '#c42a2a';
const BLACK = '#171a21';
const GOLD = '#b8923f';
const FONT = "var(--font-display), 'Bricolage Grotesque', 'Segoe UI', system-ui, sans-serif";

export type CardTint = 'gold' | 'violet';

export interface CardFaceProps {
  card: Card;
  /** Pixel width; height follows the 5:7 card ratio. */
  width: number;
  /** Large corner index and a single big suit — for small table cards. */
  compact?: boolean;
  /** Joker star under the corner index. */
  star?: boolean;
  tint?: CardTint;
  /** The simple style for Crazy and Conquer: flat white, big rank, one big suit, no pips or court art. */
  plain?: boolean;
}

/** Suit shapes on a 100 × 100 box. */
export const SUIT_PATH: Record<Suit, string> = {
  h: 'M50 90C22 67 5 50 5 31 5 16 16 6 30 6c9 0 16 5 20 13 4-8 11-13 20-13 14 0 25 10 25 25 0 19-17 36-45 59z',
  d: 'M50 3 88 50 50 97 12 50z',
  s: 'M50 5c30 24 45 40 45 57 0 14-10 22-22 22-8 0-15-4-19-10 1 10 6 16 14 20H32c8-4 13-10 14-20-4 6-11 10-19 10C15 84 5 76 5 62 5 45 20 29 50 5z',
  c: 'M50 8a19 19 0 0 1 16 29 19 19 0 1 1-12 31c1 11 6 19 15 25H31c9-6 14-14 15-25a19 19 0 1 1-12-31A19 19 0 0 1 50 8z',
};

function SuitMark({ suit, x, y, size, flip, fill }: { suit: Suit; x: number; y: number; size: number; flip?: boolean; fill?: string }) {
  const color = fill ?? (suit === 'h' || suit === 'd' ? RED : BLACK);
  return (
    <path
      d={SUIT_PATH[suit]}
      fill={color}
      transform={`translate(${x} ${y}) ${flip ? 'rotate(180)' : ''} scale(${size / 100}) translate(-50 -50)`}
    />
  );
}

/* Pip positions for 2–10 on the 100 × 140 card (pips below the middle are drawn upside down). */
const L = 35;
const C = 50;
const R = 65;
const PIPS: Record<string, [number, number][]> = {
  '2': [[C, 32], [C, 108]],
  '3': [[C, 32], [C, 70], [C, 108]],
  '4': [[L, 32], [R, 32], [L, 108], [R, 108]],
  '5': [[L, 32], [R, 32], [C, 70], [L, 108], [R, 108]],
  '6': [[L, 32], [R, 32], [L, 70], [R, 70], [L, 108], [R, 108]],
  '7': [[L, 32], [R, 32], [C, 51], [L, 70], [R, 70], [L, 108], [R, 108]],
  '8': [[L, 32], [R, 32], [C, 51], [L, 70], [R, 70], [C, 89], [L, 108], [R, 108]],
  '9': [[L, 32], [R, 32], [L, 57.3], [R, 57.3], [C, 70], [L, 82.7], [R, 82.7], [L, 108], [R, 108]],
  T: [[L, 32], [R, 32], [C, 45], [L, 57.3], [R, 57.3], [L, 82.7], [R, 82.7], [C, 95], [L, 108], [R, 108]],
};

/** The gold mark above a court card's letter: a crown for the king, a diadem for the queen, a plume for the jack. */
function CourtMark({ rank }: { rank: 'J' | 'Q' | 'K' }) {
  if (rank === 'K')
    return <path d="M36 46 38 32l6 7 6-10 6 10 6-7 2 14z M36 48h28v3H36z" fill={GOLD} />;
  if (rank === 'Q')
    return (
      <g fill={GOLD}>
        <path d="M37 47c3-8 8-12 13-12s10 4 13 12z" />
        <circle cx="50" cy="31" r="3" />
        <circle cx="40" cy="37" r="2" />
        <circle cx="60" cy="37" r="2" />
        <path d="M37 48h26v2.6H37z" />
      </g>
    );
  return <path d="M44 50c0-9 3-17 10-21-2 5-2 9 0 12 3-4 7-5 9-4-5 3-7 8-7 13z M43 50h18v2.6H43z" fill={GOLD} />;
}

function JokerFace({ width, compact }: { width: number; compact?: boolean }) {
  return (
    <svg viewBox="0 0 100 140" width={width} height={width * 1.4} aria-hidden="true" className="block">
      <rect x="1" y="1" width="98" height="138" rx="9" fill="#fffaf0" stroke="#d9b45a" strokeWidth="2" />
      <text x="10" y={compact ? 36 : 26} fontFamily={FONT} fontWeight="800" fontSize={compact ? 26 : 15} fill={RED} letterSpacing="1">
        {compact ? 'JK' : 'JOKER'}
      </text>
      <path d="M50 52 L57 69 L76 69 L61 80 L67 98 L50 87 L33 98 L39 80 L24 69 L43 69 Z" fill="#e0a92a" stroke={GOLD} strokeWidth="1.5" transform={compact ? 'translate(12 18) scale(.85)' : undefined} />
    </svg>
  );
}

/** The false joker in the simple deck: a white card with a big F and a jester. */
function PlainJoker({ width, tint }: { width: number; tint?: CardTint }) {
  return (
    <svg viewBox="0 0 100 140" width={width} height={width * 1.4} aria-hidden="true" className="block">
      <rect x="1" y="1" width="98" height="138" rx="9" fill="#ffffff" stroke={tint === 'gold' ? '#d4a72c' : '#d6ccb6'} strokeWidth={tint ? 3 : 1.4} />
      <text x="9" y="42" fontFamily={FONT} fontWeight="800" fontSize="40" fill={RED}>
        F
      </text>
      {/* A jester: three-pointed cap with bells, a smiling face and a pointed collar. */}
      <g transform="translate(54 92)">
        <path d="M-24 25-30 40-17 33-10 44 0 34 10 44 17 33 30 40 24 25Z" fill="#2f5fa8" stroke="#1c3a6b" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M-3-14C-12-32-28-37-38-27-29-27-23-20-20-6Z" fill={RED} stroke="#7d1818" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M3-14C12-32 28-37 38-27 29-27 23-20 20-6Z" fill="#2f5fa8" stroke="#1c3a6b" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M-15-8C-13-26-6-40 0-46 6-40 13-26 15-8Z" fill="#f2c94c" stroke="#a9861f" strokeWidth="1.2" strokeLinejoin="round" />
        <circle cx="-39" cy="-26" r="4" fill="#f2c94c" stroke="#a9861f" strokeWidth="1" />
        <circle cx="39" cy="-26" r="4" fill="#f2c94c" stroke="#a9861f" strokeWidth="1" />
        <circle cy="-48" r="4" fill={RED} stroke="#7d1818" strokeWidth="1" />
        <path d="M-20-8H20" stroke="#a9861f" strokeWidth="3.5" strokeLinecap="round" />
        <ellipse cy="9" rx="17" ry="19" fill="#fbe6d0" stroke="#c9a585" strokeWidth="1.2" />
        <path d="M-10 3Q-6-1-2 3M2 3Q6-1 10 3" fill="none" stroke="#2b2b33" strokeWidth="2" strokeLinecap="round" />
        <circle cx="-10" cy="12" r="3" fill={RED} opacity=".45" />
        <circle cx="10" cy="12" r="3" fill={RED} opacity=".45" />
        <path d="M-9 15Q0 25 9 15" fill="none" stroke={RED} strokeWidth="2.4" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** A card face. Compact: big index and one big suit, readable at 30–40px. Full: pips and court art. */
export function CardFace({ card, width, compact, star, tint, plain }: CardFaceProps) {
  const id = useId();
  if (isPrintedJoker(card)) return plain ? <PlainJoker width={width} tint={tint} /> : <JokerFace width={width} compact={compact} />;
  const rank = card[0] as Rank;
  const suit = card[1] as Suit;
  const color = suit === 'h' || suit === 'd' ? RED : BLACK;
  const label = RANK_LABEL[rank];
  const wide = label.length > 1;
  const court = rank === 'J' || rank === 'Q' || rank === 'K';
  const paperTop = tint === 'gold' ? '#fff6dc' : tint === 'violet' ? '#eef1ff' : '#fffdf8';
  const paperBottom = tint === 'gold' ? '#f8e7b5' : tint === 'violet' ? '#dfe5fb' : '#f4eee2';
  const border = tint === 'gold' ? '#d4a72c' : tint === 'violet' ? '#6888f5' : '#d6ccb6';

  if (plain) {
    return (
      <svg viewBox="0 0 100 140" width={width} height={width * 1.4} aria-hidden="true" className="block">
        <rect x="1" y="1" width="98" height="138" rx="9" fill={tint === 'gold' ? '#fff6dc' : tint === 'violet' ? '#eef1ff' : '#ffffff'} stroke={border} strokeWidth={tint ? 3 : 1.4} />
        <text x="9" y="42" fontFamily={FONT} fontWeight="700" fontSize={wide ? 36 : 42} letterSpacing={wide ? -3 : 0} fill={color}>
          {label}
        </text>
        <SuitMark suit={suit} x={23} y={62} size={26} />
        {star && <StarMark x={23} y={88} />}
        <SuitMark suit={suit} x={66} y={104} size={50} />
      </svg>
    );
  }

  const paper = (
    <>
      <defs>
        <linearGradient id={`${id}-p`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={paperTop} />
          <stop offset="1" stopColor={paperBottom} />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="98" height="138" rx="9" fill={`url(#${id}-p)`} stroke={border} strokeWidth={tint ? 3 : 1.4} />
    </>
  );

  if (compact) {
    return (
      <svg viewBox="0 0 100 140" width={width} height={width * 1.4} aria-hidden="true" className="block">
        {paper}
        <text x="9" y="40" fontFamily={FONT} fontWeight="700" fontSize={wide ? 34 : 40} letterSpacing={wide ? -3 : 0} fill={color}>
          {label}
        </text>
        <SuitMark suit={suit} x={23} y={60} size={26} />
        {star && <StarMark x={23} y={84} />}
        <SuitMark suit={suit} x={68} y={106} size={48} />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 100 140" width={width} height={width * 1.4} aria-hidden="true" className="block">
      {paper}
      {/* Corner indices, top-left and (upside down) bottom-right. */}
      {[false, true].map((flip) => (
        <g key={String(flip)} transform={flip ? 'rotate(180 50 70)' : undefined}>
          <text x={wide ? 5 : 8} y="25" fontFamily={FONT} fontWeight="700" fontSize={wide ? 21 : 23} letterSpacing={wide ? -2.5 : 0} fill={color}>
            {label}
          </text>
          <SuitMark suit={suit} x={wide ? 15 : 14.5} y={36} size={13} />
          {star && !flip && <StarMark x={14.5} y={52} />}
        </g>
      ))}
      {court ? (
        <g>
          <rect x="24" y="20" width="52" height="100" rx="5" fill={suit === 'h' || suit === 'd' ? '#fbece8' : '#eceef3'} stroke={color} strokeOpacity=".55" strokeWidth="1.2" />
          <rect x="27" y="23" width="46" height="94" rx="3.5" fill="none" stroke={GOLD} strokeOpacity=".7" strokeWidth=".9" />
          <CourtMark rank={rank as 'J' | 'Q' | 'K'} />
          <text x="50" y="88" textAnchor="middle" fontFamily={FONT} fontWeight="700" fontSize="38" fill={color}>
            {label}
          </text>
          <SuitMark suit={suit} x={50} y={104} size={15} />
        </g>
      ) : rank === 'A' ? (
        <g>
          {suit === 's' && <circle cx="50" cy="70" r="27" fill="none" stroke={GOLD} strokeOpacity=".6" strokeWidth="1.2" />}
          <SuitMark suit={suit} x={50} y={70} size={suit === 's' ? 40 : 36} />
        </g>
      ) : (
        (PIPS[rank] ?? []).map(([x, y], i) => <SuitMark key={i} suit={suit} x={x} y={y} size={16} flip={y > 70} />)
      )}
    </svg>
  );
}

function StarMark({ x, y }: { x: number; y: number }) {
  return <path d="M0-8 2.4-2.5 8.3-2.5 3.5 1.2 5.3 7 0 3.6-5.3 7-3.5 1.2-8.3-2.5-2.4-2.5z" transform={`translate(${x} ${y})`} fill="#e0a92a" stroke={GOLD} strokeWidth=".8" />;
}

/** Card back: midnight navy woven with the gold tibeb lattice and an emerald diamond at the centre. */
export function CardBack({ width }: { width: number }) {
  const id = useId();
  return (
    <svg viewBox="0 0 100 140" width={width} height={width * 1.4} aria-hidden="true" className="block">
      <defs>
        <pattern id={`${id}-l`} width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="#13223e" />
          <path d="M6 0 12 6 6 12 0 6z" fill="none" stroke="#e6c77f" strokeOpacity=".42" strokeWidth="1" />
          <circle cx="6" cy="6" r="1.2" fill="#e6c77f" fillOpacity=".5" />
        </pattern>
      </defs>
      <rect x="1" y="1" width="98" height="138" rx="9" fill="#fbf8f1" stroke="#cfc4ac" strokeWidth="1.4" />
      <rect x="6" y="6" width="88" height="128" rx="6" fill={`url(#${id}-l)`} />
      <rect x="6" y="6" width="88" height="128" rx="6" fill="none" stroke="#e6c77f" strokeOpacity=".8" strokeWidth="1.2" />
      <path d="M50 46 70 70 50 94 30 70z" fill="#13223e" stroke="#e6c77f" strokeWidth="1.6" />
      <path d="M50 57 61 70 50 83 39 70z" fill="#22d48a" />
    </svg>
  );
}
