'use client';

import { useId } from 'react';
import { RANK_LABEL, SUIT_SYMBOL, isPrintedJoker, type Card, type Rank, type Suit } from '@akukulu/shared';

const RED = '#c8102e';
const BLACK = '#17171c';

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

const FONT = "'Inter', 'Segoe UI', system-ui, sans-serif";

function JokerFace({ width, compact }: { width: number; compact?: boolean }) {
  return (
    <svg viewBox="0 0 100 140" width={width} height={width * 1.4} aria-hidden="true" className="block">
      <rect x="1" y="1" width="98" height="138" rx="10" fill="#fffaf0" stroke="#d9b45a" strokeWidth="2" />
      <text x="10" y={compact ? 36 : 26} fontFamily={FONT} fontWeight="800" fontSize={compact ? 26 : 16} fill={RED} letterSpacing="1">
        {compact ? 'JK' : 'JOKER'}
      </text>
      <path d="M50 52 L57 69 L76 69 L61 80 L67 98 L50 87 L33 98 L39 80 L24 69 L43 69 Z" fill="#f2b705" transform={compact ? 'translate(12 18) scale(.85)' : undefined} />
    </svg>
  );
}

/** A clean, flat card face: corner index, one large suit (or the court letter) in the middle. */
export function CardFace({ card, width, compact, star, tint }: CardFaceProps) {
  if (isPrintedJoker(card)) return <JokerFace width={width} compact={compact} />;
  const rank = card[0] as Rank;
  const suit = card[1] as Suit;
  const colour = suit === 'h' || suit === 'd' ? RED : BLACK;
  const label = RANK_LABEL[rank];
  // U+FE0E asks for the plain text glyph, so phones never swap in an emoji ♣ or ♠.
  const sym = `${SUIT_SYMBOL[suit]}︎`;
  const paper = tint === 'gold' ? '#fff4d1' : tint === 'violet' ? '#f1ebff' : '#ffffff';
  const border = tint === 'gold' ? '#e0a800' : tint === 'violet' ? '#8b5cf6' : '#d8d4c8';
  const court = rank === 'J' || rank === 'Q' || rank === 'K';
  const indexSize = compact ? (label.length > 1 ? 30 : 36) : label.length > 1 ? 24 : 28;
  return (
    <svg viewBox="0 0 100 140" width={width} height={width * 1.4} aria-hidden="true" className="block">
      <rect x="1" y="1" width="98" height="138" rx="10" fill={paper} stroke={border} strokeWidth={tint ? 3 : 1.5} />
      <g fill={colour} fontFamily={FONT} fontWeight="800">
        {/* Top-left index — the part that stays visible in a fan. */}
        <text x={compact ? 9 : 9} y={compact ? 36 : 30} fontSize={indexSize} letterSpacing={label.length > 1 ? -2 : 0}>
          {label}
        </text>
        <text x={compact ? 10 : 10} y={compact ? 66 : 54} fontSize={compact ? 28 : 22}>
          {sym}
        </text>
        {star && (
          <text x="10" y={compact ? 92 : 76} fontSize={compact ? 22 : 18} fill="#f2b705">
            ★
          </text>
        )}
        {compact ? (
          <text x="90" y="128" textAnchor="end" fontSize="44">
            {sym}
          </text>
        ) : (
          <>
            {/* Centred, and small enough to stay clear of both corner indices. */}
            {court ? (
              <text x="50" y="88" textAnchor="middle" fontSize="40" opacity="0.9">
                {label}
              </text>
            ) : (
              <text x="50" y="88" textAnchor="middle" fontSize="40">
                {sym}
              </text>
            )}
            {/* Bottom-right index, upside down. */}
            <g transform="rotate(180 50 70)">
              <text x="9" y="30" fontSize={indexSize} letterSpacing={label.length > 1 ? -2 : 0}>
                {label}
              </text>
              <text x="10" y="54" fontSize="22">
                {sym}
              </text>
            </g>
          </>
        )}
      </g>
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
