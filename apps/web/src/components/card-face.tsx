'use client';

import { useId } from 'react';
import { RANK_LABEL, SUIT_SYMBOL, isPrintedJoker, type Card, type Rank, type Suit } from '@akukulu/shared';

const RED = '#c8102e';
const BLACK = '#17171c';

/** Traditional pip positions on a 100×140 card (pips below the middle are drawn upside down). */
const PIPS: Record<string, [number, number][]> = {
  '2': [[50, 32], [50, 108]],
  '3': [[50, 32], [50, 70], [50, 108]],
  '4': [[33, 32], [67, 32], [33, 108], [67, 108]],
  '5': [[33, 32], [67, 32], [50, 70], [33, 108], [67, 108]],
  '6': [[33, 32], [67, 32], [33, 70], [67, 70], [33, 108], [67, 108]],
  '7': [[33, 32], [67, 32], [50, 51], [33, 70], [67, 70], [33, 108], [67, 108]],
  '8': [[33, 32], [67, 32], [50, 51], [33, 70], [67, 70], [50, 89], [33, 108], [67, 108]],
  '9': [[33, 30], [67, 30], [33, 56], [67, 56], [50, 70], [33, 84], [67, 84], [33, 110], [67, 110]],
  T: [[33, 30], [67, 30], [50, 43], [33, 56], [67, 56], [33, 84], [67, 84], [50, 97], [33, 110], [67, 110]],
};

/** Simple court emblems: crown (K), tiara (Q), cap with feather (J). */
const COURT: Record<string, string> = {
  K: 'M36 58 L40 42 L46 52 L50 38 L54 52 L60 42 L64 58 Z',
  Q: 'M38 58 Q40 46 44 50 Q47 40 50 46 Q53 40 56 50 Q60 46 62 58 Z',
  J: 'M38 58 Q42 44 52 44 Q60 44 62 52 L66 40 Q68 50 63 58 Z',
};

export type CardTint = 'gold' | 'violet';

export interface CardFaceProps {
  card: Card;
  /** Pixel width; height follows the 5:7 card ratio. */
  width: number;
  /** Large corner index and a single centre suit — for small table cards. */
  compact?: boolean;
  /** Joker star under the corner index. */
  star?: boolean;
  tint?: CardTint;
}

function JokerFace({ width, compact }: { width: number; compact?: boolean }) {
  const id = useId();
  return (
    <svg viewBox="0 0 100 140" width={width} height={width * 1.4} aria-hidden="true" className="block">
      <defs>
        <linearGradient id={`${id}-j`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="1" stopColor="#ffe8a8" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="98" height="138" rx="9" fill={`url(#${id}-j)`} stroke="#c8a24a" strokeWidth="2" />
      <text x="9" y={compact ? 34 : 24} fontFamily="Georgia, 'Times New Roman', serif" fontWeight="700" fontSize={compact ? 30 : 15} fill={RED} letterSpacing="1">
        {compact ? '★' : 'JOKER'}
      </text>
      {!compact && (
        <>
          <path d="M50 44 L58 64 L80 64 L62 77 L69 98 L50 85 L31 98 L38 77 L20 64 L42 64 Z" fill="#e3a008" stroke="#8a5a00" strokeWidth="2" />
          <circle cx="50" cy="72" r="6" fill={RED} />
          <text x="91" y="132" textAnchor="end" fontFamily="Georgia, serif" fontWeight="700" fontSize="15" fill={BLACK}>
            JOKER
          </text>
        </>
      )}
    </svg>
  );
}

/** A realistic card face: ivory paper, corner indices, traditional pips or a framed court card. */
export function CardFace({ card, width, compact, star, tint }: CardFaceProps) {
  const id = useId();
  if (isPrintedJoker(card)) return <JokerFace width={width} compact={compact} />;
  const rank = card[0] as Rank;
  const suit = card[1] as Suit;
  const colour = suit === 'h' || suit === 'd' ? RED : BLACK;
  const label = RANK_LABEL[rank];
  const sym = SUIT_SYMBOL[suit];
  const paper = tint === 'gold' ? ['#fffaf0', '#ffe39a'] : tint === 'violet' ? ['#fbf8ff', '#e6dcff'] : ['#ffffff', '#f4f1e8'];
  const indexSize = compact ? (label.length > 1 ? 30 : 36) : label.length > 1 ? 21 : 25;
  const court = rank === 'J' || rank === 'Q' || rank === 'K';
  return (
    <svg viewBox="0 0 100 140" width={width} height={width * 1.4} aria-hidden="true" className="block">
      <defs>
        <linearGradient id={`${id}-p`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={paper[0]} />
          <stop offset="1" stopColor={paper[1]} />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="98" height="138" rx="9" fill={`url(#${id}-p)`} stroke={tint === 'gold' ? '#d29b10' : tint === 'violet' ? '#8b5cf6' : '#c9c3b3'} strokeWidth={tint ? 3 : 1.5} />
      {/* Top-left index — the part that stays visible in a fan. */}
      <g fill={colour} fontFamily="Georgia, 'Times New Roman', serif" fontWeight="700">
        <text x={compact ? 8 : 7} y={compact ? 34 : 25} fontSize={indexSize} letterSpacing={label.length > 1 ? -2 : 0}>
          {label}
        </text>
        <text x={compact ? 9 : 8} y={compact ? 64 : 45} fontSize={compact ? 30 : 20}>
          {sym}
        </text>
        {star && (
          <text x={compact ? 10 : 9} y={compact ? 90 : 64} fontSize={compact ? 24 : 17} fill="#e3a008" stroke="#8a5a00" strokeWidth="0.8">
            ★
          </text>
        )}
      </g>
      {compact ? (
        <text x="88" y="128" textAnchor="end" fontSize="44" fill={colour}>
          {sym}
        </text>
      ) : (
        <>
          {/* Bottom-right index, upside down. */}
          <g transform="rotate(180 50 70)" fill={colour} fontFamily="Georgia, 'Times New Roman', serif" fontWeight="700">
            <text x="7" y="25" fontSize={indexSize} letterSpacing={label.length > 1 ? -2 : 0}>
              {label}
            </text>
            <text x="8" y="45" fontSize="20">
              {sym}
            </text>
          </g>
          {rank === 'A' && (
            <text x="50" y="92" textAnchor="middle" fontSize="64" fill={colour}>
              {sym}
            </text>
          )}
          {PIPS[rank]?.map(([x, y], i) => (
            <text key={i} x={x} y={y + 8} textAnchor="middle" fontSize={rank === 'T' || rank === '9' ? 20 : 23} fill={colour} transform={y > 72 ? `rotate(180 ${x} ${y})` : undefined}>
              {sym}
            </text>
          ))}
          {court && (
            <g>
              <rect x="24" y="22" width="52" height="96" rx="4" fill={suit === 'h' || suit === 'd' ? '#fde8ea' : '#ececf2'} stroke={colour} strokeWidth="1.5" />
              <path d={COURT[rank]} fill="#e3a008" stroke="#8a5a00" strokeWidth="1.2" />
              <text x="50" y="92" textAnchor="middle" fontFamily="Georgia, serif" fontWeight="700" fontSize="34" fill={colour}>
                {label}
              </text>
              <text x="50" y="112" textAnchor="middle" fontSize="18" fill={colour}>
                {sym}
              </text>
            </g>
          )}
        </>
      )}
    </svg>
  );
}

/** Card back: deep blue lattice inside a white border. */
export function CardBack({ width }: { width: number }) {
  const id = useId();
  return (
    <svg viewBox="0 0 100 140" width={width} height={width * 1.4} aria-hidden="true" className="block">
      <defs>
        <pattern id={`${id}-l`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="10" height="10" fill="#1d3a8f" />
          <path d="M0 0 L0 10 M5 0 L5 10" stroke="#3558c4" strokeWidth="2" />
        </pattern>
      </defs>
      <rect x="1" y="1" width="98" height="138" rx="9" fill="#fdfcf7" stroke="#c9c3b3" strokeWidth="1.5" />
      <rect x="7" y="7" width="86" height="126" rx="5" fill={`url(#${id}-l)`} stroke="#14286b" strokeWidth="1.5" />
      <rect x="35" y="55" width="30" height="30" rx="5" transform="rotate(45 50 70)" fill="#14286b" stroke="#e3c46a" strokeWidth="2" />
    </svg>
  );
}
