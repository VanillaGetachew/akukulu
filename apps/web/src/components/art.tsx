import type { GameSlug } from '@akukulu/shared';

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
      <LogoMark size={40} />
      <div className="leading-none">
        <div className="font-display text-lg font-extrabold tracking-tight text-fg">
          Akukulu<span className="text-lime">.</span>
        </div>
        <div className="mt-0.5 font-ethiopic text-[11px] font-semibold text-muted" lang="am">
          አኩኩሉ
        </div>
      </div>
    </div>
  );
}

function LudoThumb() {
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

function Card({ x, y, r, rank, suit, red }: { x: number; y: number; r: number; rank: string; suit: string; red?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <rect width="44" height="62" rx="7" fill="#f8f7ff" stroke="#07071a" strokeOpacity=".2" />
      <text x="7" y="17" fontSize="14" fontWeight="800" fill={red ? '#e5395c' : '#1b1b26'}>{rank}</text>
      <text x="22" y="45" fontSize="22" textAnchor="middle" fill={red ? '#e5395c' : '#1b1b26'}>{suit}</text>
    </g>
  );
}

function PokerThumb() {
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
      <rect width="120" height="120" rx="18" fill="#0f2a20" />
      <ellipse cx="60" cy="64" rx="52" ry="34" fill="#16402e" stroke="#2ee67a" strokeOpacity=".4" />
      <Card x={24} y={30} r={-12} rank="A" suit="♠" />
      <Card x={52} y={26} r={10} rank="A" suit="♥" red />
      <g transform="translate(92 92)">
        <circle r="14" fill="#8b5cf6" />
        <circle r="9" fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="3 3" />
      </g>
    </svg>
  );
}

function BlackjackThumb() {
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
      <rect width="120" height="120" rx="18" fill="#2a1030" />
      <path d="M8 96 Q60 60 112 96" fill="none" stroke="#ffc94a" strokeOpacity=".35" strokeWidth="2" />
      <Card x={22} y={24} r={-8} rank="A" suit="♦" red />
      <Card x={50} y={30} r={8} rank="K" suit="♣" />
      <rect x="34" y="92" width="52" height="20" rx="10" fill="#2ee67a" />
      <text x="60" y="107" fontSize="14" fontWeight="900" textAnchor="middle" fill="#07071a">21</text>
    </svg>
  );
}

function ConquerThumb() {
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
      <rect width="120" height="120" rx="18" fill="#2a1a08" />
      <Card x={14} y={34} r={-16} rank="5" suit="♣" />
      <Card x={38} y={26} r={-4} rank="6" suit="♣" />
      <Card x={62} y={26} r={8} rank="7" suit="♣" />
      <path d="M44 100 l8 -12 l8 8 l8 -8 l8 12 z" fill="#ffc94a" />
      <rect x="44" y="100" width="32" height="6" rx="2" fill="#ffc94a" />
    </svg>
  );
}

export function GameThumb({ slug }: { slug: GameSlug }) {
  switch (slug) {
    case 'ludo':
      return <LudoThumb />;
    case 'poker':
      return <PokerThumb />;
    case 'blackjack':
      return <BlackjackThumb />;
    case 'conquer':
      return <ConquerThumb />;
  }
}
