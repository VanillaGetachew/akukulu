import type { GameSlug, Suit } from '@akukulu/shared';
import { SUIT_PATH } from './card-face';

/** Compact brand mark (shield, crown, cards) for small sizes: header, favicon. */
export function LogoMark({ size = 36 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/akukulu-mark.svg" alt="" width={Math.round(size * 0.75)} height={size} style={{ height: size, width: 'auto' }} draggable={false} />;
}

/** Full Akukulu emblem with the ribbon and wordmark, for splash and feature spots. */
export function Emblem({ size = 220, className = '' }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/akukulu-emblem.svg" alt="Akukulu — አኩኩሉ gaming bot" width={size} height={size} className={className} draggable={false} />;
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={38} />
      <div className="leading-none">
        <div className="font-display text-[19px] font-bold tracking-[-0.02em] text-fg">
          Akukulu<span className="text-lime">.</span>
        </div>
        <div className="mt-1 font-ethiopic text-[11px] font-semibold text-gold/80" lang="am">
          አኩኩሉ
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ game artwork
 * Each game has its own world: Ludo's four-colour board, the poker room's blue felt on maroon,
 * the blackjack table's emerald baize, Conquer's meld on woven tibeb, Crazy's wild eight.
 * All on a 160 × 120 canvas, drawn to fill (slice) whatever box they are placed in.
 */

const RED = '#c42a2a';
const INK = '#171a21';

function ArtCard({ x, y, r = 0, rank, suit, w = 34 }: { x: number; y: number; r?: number; rank: string; suit: Suit; w?: number }) {
  const red = suit === 'h' || suit === 'd';
  const h = w * 1.4;
  const s = w / 100;
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <rect x={-w / 2 + 1.2} y={-h / 2 + 2.4} width={w} height={h} rx={w * 0.09} fill="#000" opacity=".35" />
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={w * 0.09} fill="#fbf8f1" stroke="#d6ccb6" strokeWidth=".8" />
      <text x={-w / 2 + w * 0.1} y={-h / 2 + w * 0.36} fontSize={w * 0.32} fontWeight="700" fontFamily="var(--font-display), sans-serif" fill={red ? RED : INK}>
        {rank}
      </text>
      <path d={SUIT_PATH[suit]} fill={red ? RED : INK} transform={`translate(${w * 0.08} ${h * 0.1}) scale(${s * 0.42}) translate(-50 -50)`} />
    </g>
  );
}

function Chip({ x, y, c, r = 9 }: { x: number; y: number; c: string; r?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy={r * 0.28} rx={r} ry={r * 0.62} fill="#000" opacity=".3" />
      <ellipse cx="0" cy="0" rx={r} ry={r * 0.62} fill={c} stroke="#fff" strokeOpacity=".9" strokeWidth="1" />
      <ellipse cx="0" cy="0" rx={r * 0.62} ry={r * 0.38} fill="none" stroke="#fff" strokeWidth="1.4" strokeDasharray="2.4 2.4" />
    </g>
  );
}

function Pawn({ x, y, c, dark }: { x: number; y: number; c: string; dark: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="2" cy="13" rx="9" ry="3.4" fill="#000" opacity=".3" />
      <path d="M-2.6-6C-3 0-9 4-9.4 9.5-9.6 13.4-5 14.6 0 14.6S9.6 13.4 9.4 9.5C9 4 3 0 2.6-6z" fill={c} stroke={dark} strokeWidth=".9" />
      <circle cx="0" cy="-9" r="5.6" fill={c} stroke={dark} strokeWidth=".9" />
      <circle cx="-1.8" cy="-11" r="1.8" fill="#fff" opacity=".7" />
    </g>
  );
}

function LudoArt() {
  const q = [
    ['#e5484d', 0, 0],
    ['#2fae61', 1, 0],
    ['#2f7be5', 0, 1],
    ['#f1b628', 1, 1],
  ] as const;
  return (
    <>
      <rect width="160" height="120" fill="#16357a" />
      <g transform="translate(80 60) rotate(-8) translate(-46 -46)">
        <rect x="-3" y="-3" width="98" height="98" rx="9" fill="#0d2457" />
        <rect width="92" height="92" rx="7" fill="#f4f1ea" />
        {q.map(([c, x, y]) => (
          <g key={c} transform={`translate(${x * 56} ${y * 56})`}>
            <rect width="36" height="36" rx="5" fill={c} />
            <rect x="7" y="7" width="22" height="22" rx="4" fill="#fff" />
          </g>
        ))}
        <path d="M36 36h20L46 46z" fill="#2fae61" />
        <path d="M56 36v20L46 46z" fill="#f1b628" />
        <path d="M36 56h20L46 46z" fill="#2f7be5" />
        <path d="M36 36v20L46 46z" fill="#e5484d" />
      </g>
      <Pawn x={52} y={50} c="#e5484d" dark="#8f1d22" />
      <Pawn x={110} y={74} c="#2f7be5" dark="#163f86" />
      <g transform="translate(120 32) rotate(14)">
        <rect x="-11" y="-11" width="22" height="22" rx="5" fill="#fff" stroke="#c9c4b6" />
        <circle cx="-5" cy="-5" r="2.2" fill={INK} />
        <circle cx="0" cy="0" r="2.2" fill={INK} />
        <circle cx="5" cy="5" r="2.2" fill={INK} />
      </g>
    </>
  );
}

function PokerArt() {
  return (
    <>
      <rect width="160" height="120" fill="#3a0f17" />
      <ellipse cx="80" cy="118" rx="110" ry="62" fill="#262a31" />
      <ellipse cx="80" cy="118" rx="98" ry="54" fill="#2a74cc" stroke="#e2a83a" strokeWidth="1.6" />
      <ellipse cx="80" cy="118" rx="70" ry="34" fill="#3a8be0" opacity=".45" />
      <ArtCard x={66} y={56} r={-12} rank="A" suit="s" w={36} />
      <ArtCard x={92} y={54} r={10} rank="K" suit="h" w={36} />
      <Chip x={34} y={92} c="#7c3aed" r={10} />
      <Chip x={34} y={87} c="#e53935" r={10} />
      <Chip x={128} y={94} c="#1f7fdc" r={10} />
      <Chip x={128} y={89} c="#f6b80e" r={10} />
      <Chip x={128} y={84} c="#2e9e48" r={10} />
    </>
  );
}

function BlackjackArt() {
  return (
    <>
      <rect width="160" height="120" fill="#0d3a28" />
      <ellipse cx="80" cy="-20" rx="120" ry="104" fill="#12503a" />
      <path d="M14 76 Q80 112 146 76" fill="none" stroke="#e6c77f" strokeOpacity=".7" strokeWidth="1.2" />
      <path d="M22 70 Q80 102 138 70" fill="none" stroke="#e6c77f" strokeOpacity=".35" strokeWidth=".8" />
      <ArtCard x={66} y={48} r={-9} rank="A" suit="d" w={36} />
      <ArtCard x={92} y={50} r={8} rank="K" suit="c" w={36} />
      <g transform="translate(80 97)">
        <rect x="-17" y="-9" width="34" height="18" rx="9" fill="#e6c77f" />
        <text x="0" y="5" fontSize="13" fontWeight="800" textAnchor="middle" fontFamily="var(--font-display), sans-serif" fill="#0d3a28">
          21
        </text>
      </g>
      <Chip x={132} y={98} c="#c42a2a" r={9} />
      <Chip x={132} y={93} c="#171a21" r={9} />
    </>
  );
}

function ConquerArt() {
  return (
    <>
      <rect width="160" height="120" fill="#3a2410" />
      {/* Woven tibeb stripes across the cloth. */}
      {[18, 102].map((y) => (
        <g key={y}>
          <rect x="0" y={y - 6} width="160" height="12" fill="#2a190a" />
          {Array.from({ length: 12 }, (_, i) => (
            <path key={i} d={`M${i * 14 + 7} ${y - 4} l4 4 -4 4 -4 -4z`} fill={i % 2 ? '#22d48a' : '#e6c77f'} opacity=".85" />
          ))}
        </g>
      ))}
      <ArtCard x={54} y={62} r={-16} rank="5" suit="c" w={32} />
      <ArtCard x={80} y={58} r={0} rank="6" suit="c" w={32} />
      <ArtCard x={106} y={62} r={16} rank="7" suit="c" w={32} />
    </>
  );
}

function CrazyArt() {
  return (
    <>
      <rect width="160" height="120" fill="#0c3b3a" />
      <g transform="translate(80 60)" opacity=".35">
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M0 0 L5 -70 L-5 -70 Z" fill="#e6c77f" transform={`rotate(${i * 30})`} />
        ))}
      </g>
      <ArtCard x={52} y={64} r={-18} rank="2" suit="h" w={32} />
      <ArtCard x={108} y={64} r={18} rank="J" suit="d" w={32} />
      <ArtCard x={80} y={58} r={0} rank="8" suit="s" w={38} />
      <path d="M0-7 2.1-2.2 7.2-2.2 3.1 1 4.6 6.1 0 3.1-4.6 6.1-3.1 1-7.2-2.2-2.1-2.2z" transform="translate(96 30) scale(1.3)" fill="#e6c77f" />
    </>
  );
}

function PenaltyArt() {
  return (
    <>
      <rect width="160" height="120" fill="#17532f" />
      <rect y="78" width="160" height="14" fill="#1d6439" />
      <rect y="106" width="160" height="14" fill="#1d6439" />
      <g stroke="#e9f3ea" strokeOpacity=".35" strokeWidth=".8">
        {Array.from({ length: 11 }, (_, i) => (
          <path key={i} d={`M${30 + i * 10} 26V76`} />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <path key={i} d={`M30 ${26 + i * 10}H130`} />
        ))}
      </g>
      <path d="M30 76V26H130V76" fill="none" stroke="#f5f7fb" strokeWidth="4" strokeLinejoin="round" />
      <g transform="translate(58 62) rotate(-32)">
        <circle cy="-22" r="5.5" fill="#e8c39e" />
        <rect x="-7" y="-17" width="14" height="18" rx="4" fill="#e6c77f" />
        <path d="M-7-14-17-24M7-14 17-24" stroke="#e6c77f" strokeWidth="4.5" strokeLinecap="round" />
        <path d="M-4 1-5 13M4 1 5 13" stroke="#202a38" strokeWidth="4.5" strokeLinecap="round" />
      </g>
      <g transform="translate(106 46)">
        <circle r="9" fill="#fff" stroke="#1c2430" strokeWidth="1.2" />
        <path d="M0-4 3.8-1.2 2.4 3.2H-2.4L-3.8-1.2Z" fill="#1c2430" />
      </g>
    </>
  );
}

function RpsArt() {
  return (
    <>
      <rect width="160" height="120" fill="#3a1d5c" />
      <g transform="translate(80 60)" opacity=".28">
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M0 0 L6 -80 L-6 -80 Z" fill="#e6c77f" transform={`rotate(${i * 30})`} />
        ))}
      </g>
      {/* A fist on the left, two fingers on the right, an open palm above. */}
      <g fill="#f0c9a0" stroke="#8a5a34" strokeWidth="1.6" strokeLinejoin="round">
        <g transform="translate(40 80) rotate(-14)">
          <rect x="-15" y="-10" width="30" height="26" rx="10" />
          <rect x="-14" y="-17" width="8" height="14" rx="4" />
          <rect x="-6.5" y="-19" width="8" height="15" rx="4" />
          <rect x="1" y="-18" width="8" height="15" rx="4" />
          <rect x="8" y="-15" width="7" height="13" rx="3.5" />
        </g>
        <g transform="translate(120 84) rotate(14)">
          <rect x="-9" y="-36" width="7" height="30" rx="3.5" transform="rotate(-12 -5 -6)" />
          <rect x="2" y="-36" width="7" height="30" rx="3.5" transform="rotate(12 5 -6)" />
          <rect x="-14" y="-10" width="28" height="26" rx="10" />
        </g>
        <g transform="translate(80 46)">
          <rect x="-13" y="-4" width="26" height="24" rx="8" />
          <rect x="-13" y="-24" width="6" height="26" rx="3" transform="rotate(-8 -10 0)" />
          <rect x="-6.5" y="-29" width="6" height="30" rx="3" />
          <rect x="0.5" y="-29" width="6" height="30" rx="3" />
          <rect x="7" y="-24" width="6" height="26" rx="3" transform="rotate(8 10 0)" />
        </g>
      </g>
    </>
  );
}

function BingoArt() {
  const balls: [number, number, number, string, string][] = [
    [42, 34, 15, '#3fb6d9', 'B7'],
    [118, 30, 14, '#d9534a', 'I22'],
    [121, 88, 15, '#3aa866', 'G54'],
    [40, 90, 13, '#9a7be0', 'O68'],
  ];
  return (
    <>
      <rect width="160" height="120" fill="#5a1f33" />
      <g transform="translate(80 62) rotate(-6)">
        <rect x="-27" y="-34" width="54" height="66" rx="6" fill="#f7f1e1" stroke="#d9cfb6" />
        {Array.from({ length: 25 }, (_, i) => {
          const marked = [0, 6, 12, 18, 24, 3, 16].includes(i);
          return <rect key={i} x={-23 + (i % 5) * 9.6} y={-22 + Math.floor(i / 5) * 10.4} width="7.6" height="8.4" rx="2" fill={marked ? '#e0a92c' : '#ffffff'} stroke="#d9cfb6" strokeWidth=".5" />;
        })}
        <rect x="-23" y="-30" width="46" height="5" rx="2" fill="#d9534a" />
      </g>
      {balls.map(([x, y, r, color, label]) => (
        <g key={label} transform={`translate(${x} ${y})`}>
          <circle r={r} fill={color} stroke="#000" strokeOpacity=".25" />
          <circle r={r * 0.62} fill="#fff" />
          <text y={r * 0.2} textAnchor="middle" fontSize={r * 0.55} fontWeight="800" fill="#10182b">
            {label}
          </text>
        </g>
      ))}
    </>
  );
}

/** Each artwork's base colour, for extending it into wider banners. */
export const ART_BG: Record<GameSlug, string> = { ludo: '#16357a', poker: '#3a0f17', blackjack: '#0d3a28', conquer: '#3a2410', crazy: '#0c3b3a', penalty: '#17532f', rps: '#3a1d5c', bingo: '#5a1f33' };

/** Game artwork, filling its box. */
export function GameThumb({ slug }: { slug: GameSlug }) {
  return (
    <svg viewBox="0 0 160 120" preserveAspectRatio="xMidYMid slice" className="block h-full w-full" aria-hidden="true">
      {slug === 'ludo' ? <LudoArt /> : slug === 'poker' ? <PokerArt /> : slug === 'blackjack' ? <BlackjackArt /> : slug === 'conquer' ? <ConquerArt /> : slug === 'penalty' ? <PenaltyArt /> : slug === 'rps' ? <RpsArt /> : slug === 'bingo' ? <BingoArt /> : <CrazyArt />}
    </svg>
  );
}

/* ------------------------------------------------------------------ classic lobby thumbnails (v1) */

function LudoThumbClassic() {
  const q = [
    ['#ff5a7a', 0, 0],
    ['#2ee67a', 1, 0],
    ['#5aa8ff', 0, 1],
    ['#ffc94a', 1, 1],
  ] as const;
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
      <rect width="120" height="120" rx="18" fill="#1a1440" />
      {q.map(([c, x, y]) => (
        <g key={c} transform={`translate(${12 + x * 56} ${12 + y * 56})`}>
          <rect width="40" height="40" rx="10" fill={c} opacity=".9" />
          <circle cx="13" cy="13" r="5" fill="#fff" />
          <circle cx="27" cy="27" r="5" fill="#fff" />
        </g>
      ))}
      <path d="M60 44 L76 60 L60 76 L44 60 Z" fill="#f3f1ff" />
      <g transform="translate(84 80) rotate(-12)">
        <rect width="26" height="26" rx="6" fill="#fff" stroke="#07071a" strokeWidth="2" />
        <circle cx="8" cy="8" r="2.6" fill="#07071a" />
        <circle cx="18" cy="18" r="2.6" fill="#07071a" />
        <circle cx="13" cy="13" r="2.6" fill="#07071a" />
      </g>
    </svg>
  );
}

function CardClassic({ x, y, r, rank, suit, red }: { x: number; y: number; r: number; rank: string; suit: string; red?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <rect width="44" height="62" rx="7" fill="#f8f7ff" stroke="#07071a" strokeOpacity=".2" />
      <text x="7" y="17" fontSize="14" fontWeight="800" fill={red ? '#e5395c' : '#1b1b26'}>{rank}</text>
      <text x="22" y="45" fontSize="22" textAnchor="middle" fill={red ? '#e5395c' : '#1b1b26'}>{suit}</text>
    </g>
  );
}

function PokerThumbClassic() {
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
      <rect width="120" height="120" rx="18" fill="#0f2a20" />
      <ellipse cx="60" cy="64" rx="52" ry="34" fill="#16402e" stroke="#2ee67a" strokeOpacity=".4" />
      <CardClassic x={24} y={30} r={-12} rank="A" suit="♠" />
      <CardClassic x={52} y={26} r={10} rank="A" suit="♥" red />
      <g transform="translate(92 92)">
        <circle r="14" fill="#8b5cf6" />
        <circle r="9" fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="3 3" />
      </g>
    </svg>
  );
}

function BlackjackThumbClassic() {
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
      <rect width="120" height="120" rx="18" fill="#2a1030" />
      <path d="M8 96 Q60 60 112 96" fill="none" stroke="#ffc94a" strokeOpacity=".35" strokeWidth="2" />
      <CardClassic x={22} y={24} r={-8} rank="A" suit="♦" red />
      <CardClassic x={50} y={30} r={8} rank="K" suit="♣" />
      <rect x="34" y="92" width="52" height="20" rx="10" fill="#2ee67a" />
      <text x="60" y="107" fontSize="14" fontWeight="900" textAnchor="middle" fill="#07071a">21</text>
    </svg>
  );
}

function ConquerThumbClassic() {
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
      <rect width="120" height="120" rx="18" fill="#2a1a08" />
      <CardClassic x={14} y={34} r={-16} rank="5" suit="♣" />
      <CardClassic x={38} y={26} r={-4} rank="6" suit="♣" />
      <CardClassic x={62} y={26} r={8} rank="7" suit="♣" />
      <path d="M44 100 l8 -12 l8 8 l8 -8 l8 12 z" fill="#ffc94a" />
      <rect x="44" y="100" width="32" height="6" rx="2" fill="#ffc94a" />
    </svg>
  );
}

function CrazyThumbClassic() {
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
      <rect width="120" height="120" rx="18" fill="#0d3b2e" />
      <CardClassic x={20} y={30} r={-14} rank="2" suit="♥" />
      <CardClassic x={52} y={22} r={10} rank="8" suit="♠" />
      <circle cx="92" cy="92" r="14" fill="#ffc94a" />
      <text x="92" y="98" fontSize="16" fontWeight="900" textAnchor="middle" fill="#07071a">★</text>
    </svg>
  );
}

/** The original v1 game thumbnails, as used on the lobby cards. */
export function GameThumbClassic({ slug }: { slug: GameSlug }) {
  switch (slug) {
    case 'ludo':
      return <LudoThumbClassic />;
    case 'poker':
      return <PokerThumbClassic />;
    case 'blackjack':
      return <BlackjackThumbClassic />;
    case 'conquer':
      return <ConquerThumbClassic />;
    case 'crazy':
      return <CrazyThumbClassic />;
    case 'penalty':
    case 'rps':
    case 'bingo':
      return <GameThumb slug={slug} />;
  }
}
