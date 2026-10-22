'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { HIDDEN_CARD, type PokerPlayerView, type PokerTournamentView, type PokerView } from '@akukulu/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Avatar, Coin, PlayingCard } from '@/components/ui';
import { useViewportHeight, useWidth } from './card-table';
import { HandHistoryList } from './poker-history';
import { nameOf, type TableProps } from './types';

const PHASE_LABEL: Record<string, string> = {
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Showdown',
  handComplete: 'Hand complete',
  waiting: 'Waiting for players',
  finished: 'Table closed',
};

/** 1st, 2nd, 3rd, 4th, … 11th, 12th, 13th, 21st. */
const ordinal = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
};

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

function useNow(serverNow: () => number, every = 250) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), every);
    return () => clearInterval(t);
  }, [serverNow, every]);
  return now;
}

/** Dark maroon backdrop with a faint fleur-de-lis pattern. */
const FLEUR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'%3E%3Cg fill='%23ffffff' fill-opacity='0.045'%3E%3Cg id='f'%3E%3Cpath d='M16 2c3 5 4 10 0 16-4-6-3-11 0-16z'/%3E%3Cpath d='M14.5 17c-5 0-9-3-8.5-7.5.4-3 4-3.3 4.4-.6-1.5-.4-2.2 1.6-.8 3.1 1.5 1.6 3.8 2.6 4.9 5z'/%3E%3Cpath d='M17.5 17c5 0 9-3 8.5-7.5-.4-3-4-3.3-4.4-.6 1.5-.4 2.2 1.6.8 3.1-1.5 1.6-3.8 2.6-4.9 5z'/%3E%3Crect x='10' y='17.5' width='12' height='2.4' rx='1'/%3E%3Cpath d='M14.6 20h2.8l.9 6-2.3-2-2.3 2z'/%3E%3C/g%3E%3Cuse href='%23f' x='32' y='32'/%3E%3C/g%3E%3C/svg%3E\")";

/** A small stack of casino chips with the amount. */
function Chips({ amount, big }: { amount: number; big?: boolean }) {
  const colors = amount >= 1000 ? ['#7c3aed', '#f6b80e', '#e53935'] : amount >= 100 ? ['#1f7fdc', '#2e9e48', '#e53935'] : ['#2e9e48', '#e53935'];
  const n = Math.min(4, 1 + Math.floor(Math.log10(Math.max(1, amount))));
  const size = big ? 22 : 18;
  return (
    <div className="flex items-center gap-1">
      <div className="relative" style={{ width: size, height: size + n * 3 }}>
        {Array.from({ length: n }, (_, i) => (
          <svg key={i} viewBox="0 0 40 40" className="absolute left-0" style={{ bottom: i * 3, width: size, height: size }}>
            <circle cx="20" cy="20" r="18" fill={colors[i % colors.length]} stroke="#fff" strokeWidth="2" />
            <circle cx="20" cy="20" r="12" fill="none" stroke="#fff" strokeWidth="3" strokeDasharray="5 5" opacity="0.9" />
            <circle cx="20" cy="20" r="7" fill="#fff" opacity="0.92" />
          </svg>
        ))}
      </div>
      <span className={`rounded-full bg-black/50 px-1.5 font-black tabular-nums text-white ${big ? 'text-[13px]' : 'text-[11px]'}`}>{amount.toLocaleString()}</span>
    </div>
  );
}

/** A seat: round avatar (with a countdown ring on their turn), name and stack below; purple name while acting. */
function Seat({
  p,
  name,
  photoUrl,
  you,
  turn,
  cardsLeft,
  reveal,
  winner,
  ratio,
  secs,
  tournament,
  waiting,
}: {
  p: PokerPlayerView;
  name: string;
  photoUrl?: string | null;
  you: boolean;
  turn: boolean;
  cardsLeft: boolean;
  /** Where shown-down cards go: beside a side seat (outer side), under a top seat, above a bottom seat. */
  reveal: 'left' | 'right' | 'above' | 'below';
  winner: boolean;
  ratio: number;
  secs: number;
  tournament: boolean;
  waiting: boolean;
}) {
  const out = p.status !== 'active';
  const tag =
    p.status === 'busted'
      ? tournament && p.place ? `Out · ${ordinal(p.place)}` : 'Busted'
      : p.status === 'left'
        ? 'Left'
        : p.folded
          ? 'Fold'
          : p.allIn
            ? 'All-in'
            : waiting
              ? 'Next hand'
              : null;
  const R = 24;
  const C = 2 * Math.PI * R;
  const holding = !you && p.inHand && !p.folded && p.hole.length > 0;
  const faceUp = holding && p.hole.some((c) => c !== HIDDEN_CARD);
  const shownCards = faceUp && (
    <div className="flex -space-x-2">
      {p.hole.map((c, i) => (
        <div key={`${c}${i}`} className="w-[30px]" style={{ transform: `rotate(${i ? 6 : -6}deg)` }}>
          <PlayingCard card={c} size="sm" />
        </div>
      ))}
    </div>
  );
  return (
    <div className={`flex w-[80px] flex-col items-center ${out || p.folded ? 'opacity-55' : ''}`}>
      {shownCards && reveal === 'above' && <div className="relative z-[2] -mb-3">{shownCards}</div>}
      <div className="relative grid h-[54px] w-[54px] place-items-center">
        {shownCards && (reveal === 'left' || reveal === 'right') && (
          <div className={`absolute top-1/2 z-[2] -translate-y-1/2 ${reveal === 'left' ? 'right-[calc(100%-6px)]' : 'left-[calc(100%-6px)]'}`}>{shownCards}</div>
        )}
        {/* Card backs tucked behind the avatar while the hand is on. */}
        {holding && !faceUp && (
          <div className={`absolute -top-1 flex -space-x-3 ${cardsLeft ? '-left-4' : '-right-4'}`}>
            {p.hole.map((c, i) => (
              <div key={i} className="w-[20px]" style={{ transform: `rotate(${(i ? 12 : -4) * (cardsLeft ? -1 : 1)}deg)` }}>
                <PlayingCard card={c} size="sm" />
              </div>
            ))}
          </div>
        )}
        <div className={`relative rounded-full ring-2 ${turn ? 'ring-transparent' : winner ? 'ring-gold' : 'ring-black/40'}`}>
          <Avatar name={name} photoUrl={photoUrl} size={44} />
        </div>
        {turn && (
          <>
            <svg viewBox="0 0 54 54" className="absolute inset-0 -rotate-90">
              <circle cx="27" cy="27" r={R} fill="none" stroke="rgba(0,0,0,.45)" strokeWidth="4" />
              <circle cx="27" cy="27" r={R} fill="none" stroke={ratio > 0.3 ? '#a78bfa' : '#ff5a4f'} strokeWidth="4" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - ratio)} />
            </svg>
            <span className="absolute -right-2 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#7c3aed] px-1 text-[10px] font-black text-white shadow">{secs}</span>
          </>
        )}
        {tag && <span className="absolute bottom-0 z-[3] whitespace-nowrap rounded bg-[#2a2d36] px-1.5 text-[9px] font-black uppercase leading-4 text-white/85 shadow ring-1 ring-black/40">{tag}</span>}
      </div>
      <div className={`mt-1 max-w-full truncate rounded px-1.5 text-[11px] font-extrabold leading-4 ${turn ? 'bg-[#7c3aed] text-white' : winner ? 'bg-gold text-[#15171d]' : 'text-white'}`}>
        {you ? 'You' : name}
      </div>
      <div className="mt-0.5 rounded-full bg-black/60 px-2 text-[11px] font-black tabular-nums leading-4 text-white ring-1 ring-white/10">{p.stack.toLocaleString()}</div>
      {p.handLabel && !p.folded && (
        <div className={`mt-0.5 w-max max-w-[120px] rounded px-1.5 text-center text-[10px] font-extrabold leading-[13px] text-gold ${you ? 'bg-black/70 ring-1 ring-gold/40' : 'bg-black/55'}`}>{p.handLabel}</div>
      )}
      {shownCards && reveal === 'below' && <div className="relative z-[2] mt-1">{shownCards}</div>}
    </div>
  );
}

function ActionBar({ view, act, pending }: { view: PokerView; act: TableProps<PokerView>['act']; pending: boolean }) {
  const legal = view.legal!;
  const [amount, setAmount] = useState(legal.minAmount);
  useEffect(() => setAmount(legal.minAmount), [legal.minAmount, view.handNumber, view.phase]);
  const aggressive = legal.canBet || legal.canRaise;
  // Pot-sized raises: "raise to" = current bet + fraction × (pot after calling).
  const afterCall = view.pot + legal.callAmount;
  const presets = [
    { label: '½ pot', value: view.currentBet + Math.floor(afterCall / 2) },
    { label: '¾ pot', value: view.currentBet + Math.floor((afterCall * 3) / 4) },
    { label: 'Pot', value: view.currentBet + afterCall },
  ].filter((p) => p.value > legal.minAmount && p.value < legal.maxAmount);
  const allIn = amount >= legal.maxAmount;
  return (
    <div className="grid gap-2 rounded-2xl bg-[#1b1d24]/95 p-2.5 shadow-2xl ring-1 ring-white/10">
      {aggressive && (
        <div className="grid gap-1.5">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={legal.minAmount}
              max={legal.maxAmount}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="h-2 flex-1 accent-[#2ecc71]"
              aria-label="Bet amount"
            />
            <span className="w-16 text-right text-sm font-black tabular-nums text-gold">{amount.toLocaleString()}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold" onClick={() => setAmount(legal.minAmount)}>
              Min
            </button>
            {presets.map((p) => (
              <button key={p.label} className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold" onClick={() => setAmount(p.value)}>
                {p.label}
              </button>
            ))}
            <button className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold" onClick={() => setAmount(legal.maxAmount)}>
              All-in
            </button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <button className="rounded-xl bg-[#3a3d47] py-3 text-sm font-black text-white shadow active:scale-95 disabled:opacity-50" disabled={pending} onClick={() => void act({ type: 'fold' })}>
          Fold
        </button>
        {legal.canCheck ? (
          <button className="rounded-xl bg-[#2c6fd6] py-3 text-sm font-black text-white shadow active:scale-95 disabled:opacity-50" disabled={pending} onClick={() => void act({ type: 'check' })}>
            Check
          </button>
        ) : (
          <button className="rounded-xl bg-[#2c6fd6] py-3 text-sm font-black text-white shadow active:scale-95 disabled:opacity-50" disabled={pending} onClick={() => void act({ type: 'call' })}>
            Call {legal.callAmount.toLocaleString()}
          </button>
        )}
        {aggressive ? (
          <button
            className="rounded-xl bg-[#27ae60] py-3 text-sm font-black text-white shadow active:scale-95 disabled:opacity-50"
            disabled={pending}
            onClick={() => void act(allIn ? { type: 'allIn' } : { type: legal.canBet ? 'bet' : 'raise', amount })}
          >
            {allIn ? 'All-in' : `${legal.canBet ? 'Bet' : 'Raise to'} ${amount.toLocaleString()}`}
          </button>
        ) : (
          <button className="rounded-xl bg-[#27ae60] py-3 text-sm font-black text-white shadow active:scale-95 disabled:opacity-50" disabled={pending || legal.callAmount === 0} onClick={() => void act({ type: 'allIn' })}>
            All-in
          </button>
        )}
      </div>
    </div>
  );
}

/** A panel that slides up from the bottom of the table. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[45] flex items-end justify-center bg-black/60 backdrop-blur-[2px]" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="max-h-[82vh] w-full max-w-[560px] animate-pop overflow-y-auto rounded-t-3xl bg-[#1b1d24] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white shadow-2xl ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-extrabold">{title}</h2>
          <button className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-sm font-bold" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-white/[0.06] py-2 text-sm last:border-0">
      <span className="text-white/60">{label}</span>
      <span className="font-black tabular-nums">{value}</span>
    </div>
  );
}

/** Tournament lobby inside the table: prize pool, level clock, stacks, and the prize list. */
function TournamentInfo({ t, now }: { t: PokerTournamentView; now: number }) {
  const [tab, setTab] = useState<'info' | 'prizes'>('info');
  const blinds = (sb: number, bb: number, ante?: number | null) => `${sb.toLocaleString()}/${bb.toLocaleString()}${ante ? ` · ante ${ante.toLocaleString()}` : ''}`;
  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-black/30 p-1 text-sm font-bold">
        {(['info', 'prizes'] as const).map((k) => (
          <button key={k} className={`rounded-lg py-1.5 ${tab === k ? 'bg-white/15' : 'text-white/60'}`} onClick={() => setTab(k)}>
            {k === 'info' ? 'Info' : 'Prizes'}
          </button>
        ))}
      </div>
      {tab === 'info' ? (
        <div>
          <Row label="Prize pool" value={<span className="text-gold">{t.prizePool.toLocaleString()}</span>} />
          <Row label="1st prize" value={(t.payouts[0] ?? 0).toLocaleString()} />
          <Row label="Places paid" value={t.payouts.length} />
          <Row
            label={`Level ${t.level}`}
            value={
              t.kind === 'mtt'
                ? t.levelEndsAt
                  ? t.levelEndsAt > now ? clock(t.levelEndsAt - now) : 'rises next hand'
                  : 'last level'
                : t.nextBigBlind
                  ? `${t.handsToNextLevel} hand${t.handsToNextLevel === 1 ? '' : 's'} left`
                  : 'last level'
            }
          />
          <Row label="Blinds" value={blinds(t.smallBlind, t.bigBlind, t.ante)} />
          {t.nextBigBlind && <Row label="Next level" value={blinds(t.nextSmallBlind!, t.nextBigBlind, t.nextAnte)} />}
          <Row label="Players left" value={`${t.playersLeft} / ${t.entrants}`} />
          {t.myRank != null && <Row label="My position" value={`${t.myRank} / ${t.playersLeft}`} />}
          {t.myPlace != null && <Row label="I finished" value={ordinal(t.myPlace)} />}
          {t.stacks && (
            <>
              <Row label="Smallest stack" value={t.stacks.min.toLocaleString()} />
              <Row label="Average stack" value={t.stacks.avg.toLocaleString()} />
              <Row label="Largest stack" value={t.stacks.max.toLocaleString()} />
            </>
          )}
          {t.tables != null && <Row label="Tables" value={t.tables} />}
          {t.lateRegEndsAt != null && t.lateRegEndsAt > now && <Row label="Late registration" value={clock(t.lateRegEndsAt - now)} />}
        </div>
      ) : (
        <div>
          {t.payouts.map((prize, i) => (
            <Row key={i} label={`${ordinal(i + 1)} place`} value={<span className={i === 0 ? 'text-gold' : ''}>{prize.toLocaleString()}</span>} />
          ))}
        </div>
      )}
    </>
  );
}

/** Buy-in picker for a free seat at a cash table. */
function SitDown({ matchId, seat, cash, onDone }: { matchId: string; seat: number; cash: NonNullable<PokerView['cash']>; onDone: () => void }) {
  const { user } = useSession();
  const balance = user?.balance ?? 0;
  const max = Math.min(cash.maxBuyIn, balance);
  const [amount, setAmount] = useState(Math.max(cash.minBuyIn, Math.min(max, cash.maxBuyIn)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = balance < cash.minBuyIn;
  const sit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/poker/tables/${matchId}/sit`, { body: { buyIn: amount, seat } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <p className="text-sm text-white/70">
        Buy in for {cash.minBuyIn.toLocaleString()}–{cash.maxBuyIn.toLocaleString()} chips. You are dealt in from the next hand (posting a big blind if a game is
        running) and can stand up with your chips at any time.
      </p>
      {short ? (
        <p className="rounded-xl bg-danger/15 px-3 py-2 text-sm font-bold text-danger">You need at least {cash.minBuyIn.toLocaleString()} points to sit here.</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <input type="range" min={cash.minBuyIn} max={max} step={Math.max(1, Math.floor(cash.minBuyIn / 40))} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="h-2 flex-1 accent-[#2ecc71]" aria-label="Buy-in" />
            <span className="flex w-24 items-center justify-end gap-1 text-base font-black tabular-nums text-gold">
              <Coin className="h-4 w-4" /> {amount.toLocaleString()}
            </span>
          </div>
          <div className="flex gap-2 text-xs font-bold">
            <button className="rounded-full bg-white/10 px-3 py-1" onClick={() => setAmount(cash.minBuyIn)}>
              Min
            </button>
            <button className="rounded-full bg-white/10 px-3 py-1" onClick={() => setAmount(max)}>
              Max
            </button>
            <span className="ml-auto self-center text-white/50">Balance {balance.toLocaleString()}</span>
          </div>
          <button className="rounded-xl bg-[#27ae60] py-3 text-sm font-black text-white disabled:opacity-50" disabled={busy} onClick={sit}>
            {busy ? 'Sitting down…' : `Sit down with ${amount.toLocaleString()}`}
          </button>
        </>
      )}
      {error && <p className="text-sm font-bold text-danger">{error}</p>}
    </div>
  );
}

function CornerButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className="grid h-10 w-10 place-items-center rounded-full bg-black/45 text-white/90 shadow-lg ring-1 ring-white/10 active:scale-95">
      {children}
    </button>
  );
}

export function PokerTable({ state, view, act, pending, serverNow }: TableProps<PokerView>) {
  const { user } = useSession();
  const now = useNow(serverNow);
  const meIndex = view.players.findIndex((p) => p.playerId === user?.id);
  const me = meIndex >= 0 && view.players[meIndex].status === 'active' ? view.players[meIndex] : null;
  const n = view.players.length;
  const myTurn = !!view.legal && view.currentPlayerId === user?.id;
  const last = view.lastHand;
  const done = view.phase === 'handComplete' || view.phase === 'finished' || view.phase === 'waiting';
  const betting = ['preflop', 'flop', 'turn', 'river'].includes(view.phase);
  const winners = new Set(done ? (last?.pots.flatMap((p) => p.winners) ?? []) : []);
  const t = view.tournament;
  const cash = view.cash ?? null;
  const [sheet, setSheet] = useState<null | 'menu' | 'history' | 'tournament' | 'settings' | { sit: number }>(null);

  // Auto check / fold: acts for me as soon as it is my turn.
  const [autoCheckFold, setAutoCheckFold] = useState(false);
  useEffect(() => {
    if (!autoCheckFold || !myTurn || pending || !view.legal) return;
    void act({ type: view.legal.canCheck ? 'check' : 'fold' });
    if (!view.legal.canCheck) setAutoCheckFold(false);
  }, [autoCheckFold, myTurn, pending, view.legal, act]);
  useEffect(() => setAutoCheckFold(false), [view.handNumber]);

  // A fixed table size from the screen: an upright oval on a phone, a flat one on a wide screen.
  const [boxRef, boxWidth] = useWidth<HTMLDivElement>();
  const vh = useViewportHeight();
  const portrait = boxWidth < 560;
  const room = vh - (t ? 262 : 236);
  const feltW = portrait ? Math.max(220, boxWidth - 120) : Math.min(boxWidth - 130, 720);
  const feltH = portrait ? Math.max(260, Math.min(feltW * 1.7, room - 100)) : Math.max(220, Math.min(feltW * 0.55, room - 100));
  const areaW = feltW + 120;
  const areaH = feltH + (portrait ? 130 : 140);
  const cx = areaW / 2;
  const cy = areaH / 2;

  // Seat positions round the oval with me at the bottom. Cash tables keep every seat in its
  // place (so empty seats can be taken); other tables space the players evenly.
  const slots = cash ? view.config.maxSeats : Math.max(n, 1);
  const anchor = cash ? (me?.seat ?? 0) : 0;
  const slotOf = (p: PokerPlayerView, i: number) => (cash ? (p.seat - anchor + slots) % slots : (i - Math.max(0, meIndex) + n) % n);
  const seatAt = (k: number) => {
    const a = Math.PI / 2 + (2 * Math.PI * k) / slots;
    return { x: cx + (feltW / 2 + 6) * Math.cos(a), y: cy + (feltH / 2 + 6) * Math.sin(a) };
  };
  const cardSize = feltW >= 270 ? 'md' : 'sm';

  const ratioFor = (p: PokerPlayerView) => {
    if (p.playerId !== view.currentPlayerId || !view.turnDeadline) return 0;
    return Math.max(0, Math.min(1, (view.turnDeadline - now) / (view.config.turnSeconds * 1000)));
  };
  const secsLeft = view.turnDeadline ? Math.max(0, Math.ceil((view.turnDeadline - now) / 1000)) : 0;
  const labelOf = (id: string) => view.players.find((p) => p.playerId === id)?.handLabel;
  const resultText =
    last && done && view.phase !== 'waiting'
      ? last.pots
          .map((pt) => {
            const hand = last.showdown.length ? labelOf(pt.winners[0]) : null;
            return `${pt.winners.map((w) => (w === user?.id ? 'You' : nameOf(state, w))).join(' & ')} won ${pt.amount.toLocaleString()}${hand ? ` · ${hand}` : ''}`;
          })
          .join(' · ')
      : null;

  // The small grey line on the felt, like "Original, 5/10, ante 1 (6)".
  const ante = t?.ante ?? view.config.ante ?? 0;
  const infoLine = [
    t ? (t.name ?? 'Sit & Go') : (cash?.name ?? "Hold'em"),
    `Blinds ${view.config.smallBlind.toLocaleString()}/${view.config.bigBlind.toLocaleString()}${ante ? ` ante ${ante.toLocaleString()}` : ''}`,
  ].join(', ') + ` (${view.players.filter((p) => p.status === 'active').length})`;
  const myPlace = t?.myPlace ?? (me ? null : view.players[meIndex]?.place) ?? null;
  const tableTitle = t ? (t.kind === 'mtt' ? `${t.name} · Table ${t.tableNumber ?? 1}` : 'Sit & Go') : (cash?.name ?? 'Cash game');

  const leave = () => {
    const msg = cash ? 'Stand up and cash out your chips?' : t ? 'Leave the tournament? You forfeit your chips.' : 'Leave the table? You cash out your chips.';
    if (confirm(msg)) void act({ type: 'leave' });
    setSheet(null);
  };

  return (
    <div className="fixed inset-0 z-[35] flex flex-col overflow-hidden text-white" style={{ backgroundColor: '#2a0a10', backgroundImage: `${FLEUR}, radial-gradient(ellipse at center, #4a121c 0%, #2a0a10 75%)` }}>
      {/* Top bar: menu, the table tab, and the table id. */}
      <div className="flex shrink-0 items-center gap-2 bg-black/30 px-2 py-1.5">
        <button aria-label="Menu" className="grid h-8 w-8 place-items-center rounded-lg bg-white/10" onClick={() => setSheet('menu')}>
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
            <rect x="3" y="4" width="14" height="2" rx="1" />
            <rect x="3" y="9" width="14" height="2" rx="1" />
            <rect x="3" y="14" width="14" height="2" rx="1" />
          </svg>
        </button>
        <div className="min-w-0 truncate rounded-t-lg border-b-2 border-[#e8762c] bg-white/10 px-3 py-1 text-xs font-extrabold">{tableTitle}</div>
        <Link href="/games/poker" className="rounded-lg bg-white/10 px-2 py-1 text-xs font-bold text-white/80">
          Lobby
        </Link>
        <span className="ml-auto shrink-0 text-[10px] font-bold tabular-nums text-white/45">ID {state.matchId.slice(0, 8).toUpperCase()}</span>
      </div>
      {t && (
        <button className="mx-2 mt-1.5 flex shrink-0 flex-wrap items-center justify-center gap-1.5 text-[11px] font-bold" onClick={() => setSheet('tournament')}>
          <span className="rounded-full bg-gold px-2 py-0.5 text-[#15171d]">Level {t.level}</span>
          {t.nextBigBlind != null && (
            <span className="rounded-full bg-white/10 px-2 py-0.5">
              Next {t.nextSmallBlind}/{t.nextBigBlind}{' '}
              {t.kind === 'mtt' ? (t.levelEndsAt ? (t.levelEndsAt > now ? `in ${clock(t.levelEndsAt - now)}` : 'next hand') : '') : `in ${t.handsToNextLevel} hand${t.handsToNextLevel === 1 ? '' : 's'}`}
            </span>
          )}
          <span className="rounded-full bg-white/10 px-2 py-0.5">Prize {t.prizePool.toLocaleString()}</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5">
            {t.playersLeft}/{t.entrants} left
          </span>
          <span className="rounded-full bg-white/10 px-2 py-0.5">ⓘ</span>
        </button>
      )}

      <div ref={boxRef} className="relative mx-auto min-h-0 w-full max-w-[830px] flex-1">
        <div className="relative mx-auto" style={{ width: areaW, height: areaH }}>
          {/* The table: an orange rail round an oval blue felt. */}
          <div
            className="absolute rounded-[50%] shadow-[0_20px_45px_rgba(0,0,0,.65)]"
            style={{ left: cx - feltW / 2 - 13, top: cy - feltH / 2 - 13, width: feltW + 26, height: feltH + 26, background: 'linear-gradient(160deg,#f7a24a 0%,#e8762c 45%,#b9541a 100%)' }}
          />
          <div className="absolute rounded-[50%] ring-[3px] ring-black/35" style={{ left: cx - feltW / 2 - 2, top: cy - feltH / 2 - 2, width: feltW + 4, height: feltH + 4 }} />
          <div
            className="absolute overflow-hidden rounded-[50%] shadow-[inset_0_0_45px_rgba(0,0,0,.5)]"
            style={{ left: cx - feltW / 2, top: cy - feltH / 2, width: feltW, height: feltH, background: 'radial-gradient(ellipse at center, #3b82c9 0%, #2564a8 55%, #184a85 100%)' }}
          >
            <div className="absolute inset-[9%] rounded-[50%] border border-white/10" />
          </div>

          {/* Middle: the info line, the pot and the board. */}
          <div className="absolute flex flex-col items-center gap-1.5" style={{ left: cx, top: cy, width: Math.min(feltW * 0.84, 330), transform: 'translate(-50%, -55%)' }}>
            <div className="max-w-full truncate text-center text-[10px] font-semibold text-white/55">{infoLine}</div>
            <div className="flex h-6 items-center gap-1.5">
              {view.pot > 0 && (
                <>
                  <span className="text-xs font-black text-white/90">Pot: {view.pot.toLocaleString()}</span>
                  <Chips amount={view.pot} />
                </>
              )}
            </div>
            <div className="flex gap-1">
              {view.community.map((c, i) => (
                <PlayingCard key={c} card={c} size={cardSize} delay={i * 90} highlight={done && !!last?.showdown.some((s) => s.best.includes(c))} />
              ))}
              {Array.from({ length: 5 - view.community.length }, (_, i) => (
                <div key={i} className={`rounded-lg border border-white/15 bg-white/[0.04] ${cardSize === 'sm' ? 'h-[50px] w-9' : 'h-[73px] w-[52px]'}`} />
              ))}
            </div>
            {view.phase === 'waiting' && <div className="rounded-full bg-black/45 px-3 py-1 text-center text-[11px] font-bold text-white/85">{cash ? 'Waiting for another player to sit down…' : 'Waiting for players…'}</div>}
            {resultText && <div className="max-w-full rounded-full bg-black/55 px-3 py-1 text-center text-[11px] font-bold text-gold">{resultText}</div>}
          </div>

          {/* Free seats at a cash table: tap to sit down. */}
          {cash &&
            cash.freeSeats.map((seat) => {
              const { x, y } = seatAt((seat - anchor + slots) % slots);
              return (
                <div key={`free${seat}`} className="absolute" style={{ left: x, top: y, transform: 'translate(-50%, -50%)', zIndex: 5 }}>
                  {me ? (
                    <div className="h-11 w-11 rounded-full border-2 border-dashed border-white/15 bg-black/20" />
                  ) : (
                    <button className="grid h-12 w-12 place-items-center rounded-full border-2 border-dashed border-white/40 bg-black/35 text-[11px] font-black uppercase text-white/90 active:scale-95" onClick={() => setSheet({ sit: seat })}>
                      Sit
                    </button>
                  )}
                </div>
              );
            })}

          {/* Seats, their bets in front of them, and the dealer button. */}
          {view.players.map((p, i) => {
            const { x, y } = seatAt(slotOf(p, i));
            const info = state.players.find((x2) => x2.userId === p.playerId);
            const toward = (f: number) => ({ left: x + (cx - x) * f, top: y + (cy - y) * f });
            const isMe = p.playerId === user?.id;
            return (
              <div key={p.playerId}>
                <div className="absolute" style={{ left: x, top: y, transform: 'translate(-50%, -50%)', zIndex: 5 }}>
                  <Seat
                    p={p}
                    name={info?.displayName ?? 'Player'}
                    photoUrl={info?.photoUrl}
                    you={isMe}
                    turn={p.playerId === view.currentPlayerId && !done}
                    cardsLeft={x < cx - 4}
                    reveal={Math.abs(x - cx) > feltW * 0.25 ? (x < cx ? 'left' : 'right') : y < cy ? 'below' : 'above'}
                    winner={winners.has(p.playerId)}
                    ratio={ratioFor(p)}
                    secs={secsLeft}
                    tournament={!!t}
                    waiting={betting && p.status === 'active' && !p.inHand}
                  />
                </div>
                {p.committed > 0 && (
                  <div className="absolute" style={{ ...toward(isMe ? 0.42 : 0.36), transform: 'translate(-50%, -50%)', zIndex: 4 }}>
                    <Chips amount={p.committed} />
                  </div>
                )}
                {p.isButton && (
                  <div
                    className="absolute grid h-6 w-6 place-items-center rounded-full bg-white text-[11px] font-black text-[#15171d] shadow ring-2 ring-black/25"
                    style={{ ...toward(Math.abs(x - cx) > feltW * 0.25 ? 0.14 : 0.26), transform: `translate(-50%, -50%) ${Math.abs(x - cx) > feltW * 0.25 ? 'translate(0, -34px)' : 'translate(30px, 0)'}`, zIndex: 4 }}
                  >
                    D
                  </div>
                )}
              </div>
            );
          })}

          {/* My two cards face up beside my seat, with what I have right now under them. */}
          {me && me.hole.length > 0 && (
            <div className="absolute flex flex-col items-start gap-1" style={{ left: cx + 44, top: seatAt(0).y, transform: 'translateY(-55%)', zIndex: 6 }}>
              <div className="flex -space-x-3">
                {me.hole.map((c, i) => (
                  <div key={c} className={me.folded ? 'opacity-40' : ''} style={{ transform: `rotate(${i ? 7 : -5}deg) translateY(${i ? 2 : 0}px)` }}>
                    <PlayingCard card={c} size="md" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom corners: hand history and settings. */}
        <div className="absolute bottom-2 left-2 z-[7]">
          <CornerButton label="Hand history" onClick={() => setSheet('history')}>
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3.5 10a6.5 6.5 0 1 0 2-4.7" strokeLinecap="round" />
              <path d="M3 3.5v3h3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M10 6.5V10l2.5 1.6" strokeLinecap="round" />
            </svg>
          </CornerButton>
        </div>
        <div className="absolute bottom-2 right-2 z-[7]">
          <CornerButton label="Settings" onClick={() => setSheet('settings')}>
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
              <path d="M11.3 1.5l.4 2.1c.5.2 1 .5 1.4.8l2-.8 1.3 2.3-1.6 1.4c.1.5.1 1 0 1.5l1.6 1.4-1.3 2.3-2-.8c-.4.3-.9.6-1.4.8l-.4 2.1H8.7l-.4-2.1c-.5-.2-1-.5-1.4-.8l-2 .8-1.3-2.3 1.6-1.4a4.7 4.7 0 0 1 0-1.5L3.6 5.9l1.3-2.3 2 .8c.4-.3.9-.6 1.4-.8l.4-2.1h2.6zM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
            </svg>
          </CornerButton>
        </div>
      </div>

      {/* Bottom: my actions, or what is going on. */}
      <div className="mx-auto w-full max-w-[560px] shrink-0 px-2 pb-[max(0.6rem,env(safe-area-inset-bottom))]">
        {myPlace != null && t && (
          <div className="mb-2 rounded-xl bg-gold/15 px-3 py-2 text-center text-sm font-black text-gold">
            You finished {ordinal(myPlace)}
            {t.payouts[myPlace - 1] ? ` — prize ${t.payouts[myPlace - 1].toLocaleString()}` : ''}
          </div>
        )}
        {myTurn && view.legal ? (
          <ActionBar view={view} act={act} pending={pending} />
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-2xl bg-[#1b1d24]/90 px-3 py-2.5 text-xs ring-1 ring-white/10">
            <span className="truncate font-bold text-white/80">
              {view.phase === 'finished'
                ? t ? 'Tournament over' : 'Table closed'
                : !me && cash
                  ? 'Watching — tap a free seat to sit down'
                  : view.phase === 'waiting'
                    ? PHASE_LABEL.waiting
                    : done
                      ? 'Next hand starting…'
                      : `${PHASE_LABEL[view.phase]} · ${view.currentPlayerId ? `${nameOf(state, view.currentPlayerId)} to act` : ''}`}
            </span>
            {me && me.inHand && !me.folded && !done && (
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 font-bold">
                <input type="checkbox" checked={autoCheckFold} onChange={(e) => setAutoCheckFold(e.target.checked)} className="h-4 w-4 accent-[#2ecc71]" />
                Check / fold
              </label>
            )}
          </div>
        )}
      </div>

      {sheet === 'menu' && (
        <Sheet title="Menu" onClose={() => setSheet(null)}>
          <div className="grid gap-2 text-sm font-bold">
            <Link href="/games/poker" className="rounded-xl bg-white/10 px-4 py-3">
              Back to the lobby
            </Link>
            <button className="rounded-xl bg-white/10 px-4 py-3 text-left" onClick={() => setSheet('history')}>
              Hand history
            </button>
            {t && (
              <button className="rounded-xl bg-white/10 px-4 py-3 text-left" onClick={() => setSheet('tournament')}>
                Tournament info
              </button>
            )}
            {me && view.phase !== 'finished' && (
              <button className="rounded-xl bg-danger/20 px-4 py-3 text-left text-danger" onClick={leave}>
                {cash ? 'Stand up and cash out' : t ? 'Leave the tournament' : 'Leave the table'}
              </button>
            )}
          </div>
        </Sheet>
      )}
      {sheet === 'history' && (
        <Sheet title="Hand history" onClose={() => setSheet(null)}>
          <HandHistoryList matchId={state.matchId} empty="No hands at this table yet." />
        </Sheet>
      )}
      {sheet === 'tournament' && t && (
        <Sheet title={t.name ?? 'Sit & Go'} onClose={() => setSheet(null)}>
          <TournamentInfo t={t} now={now} />
        </Sheet>
      )}
      {sheet === 'settings' && (
        <Sheet title="Settings" onClose={() => setSheet(null)}>
          <div className="grid gap-2 text-sm font-bold">
            <label className="flex items-center justify-between rounded-xl bg-white/10 px-4 py-3">
              Auto check / fold this hand
              <input type="checkbox" checked={autoCheckFold} onChange={(e) => setAutoCheckFold(e.target.checked)} className="h-5 w-5 accent-[#2ecc71]" disabled={!me?.inHand || me.folded} />
            </label>
            {me && view.phase !== 'finished' && (
              <button className="rounded-xl bg-danger/20 px-4 py-3 text-left text-danger" onClick={leave}>
                {cash ? 'Stand up and cash out' : t ? 'Leave the tournament' : 'Leave the table'}
              </button>
            )}
          </div>
        </Sheet>
      )}
      {sheet !== null && typeof sheet === 'object' && cash && (
        <Sheet title={`Sit down · ${cash.name ?? 'Cash table'}`} onClose={() => setSheet(null)}>
          <SitDown matchId={state.matchId} seat={sheet.sit} cash={cash} onDone={() => setSheet(null)} />
        </Sheet>
      )}
    </div>
  );
}
