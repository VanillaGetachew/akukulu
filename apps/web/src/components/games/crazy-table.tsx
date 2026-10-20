'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RANK_LABEL, SUIT_SYMBOL, type Card, type CrazyLastEvent, type CrazyView, type Rank, type Suit } from '@akukulu/shared';
import { useSession } from '@/lib/session';
import { CardBack, CardFace } from '@/components/card-face';
import { ShuffleAndDeal, dealtCount } from '@/components/fx';
import { ActionButton, DeckStack, DiscardPile, useViewportHeight, useWidth } from './card-table';
import { nameOf, type TableProps } from './types';

const label = (c: Card) => `${RANK_LABEL[c[0] as Rank]}${SUIT_SYMBOL[c[1] as Suit]}`;
const SUIT_NAME: Record<Suit, string> = { h: 'Hearts', d: 'Diamonds', c: 'Clubs', s: 'Spades' };
const SUIT_PICK_ORDER: Suit[] = ['h', 'c', 'd', 's'];
const red = (s: Suit) => s === 'h' || s === 'd';
const RANK_ORDER = 'A23456789TJQK';
const bySuitRank = (a: Card, b: Card) => 'shdc'.indexOf(a[1]) - 'shdc'.indexOf(b[1]) || RANK_ORDER.indexOf(a[0]) - RANK_ORDER.indexOf(b[0]);

/** The player's hand on a shallow arc that always fits its box. Cards that cannot be played are dimmed on your turn. */
function HandFan({
  cards,
  width,
  cardWidth,
  selected,
  playable,
  onTap,
  wildEights,
}: {
  cards: Card[];
  width: number;
  cardWidth: number;
  selected: Card | null;
  playable: Set<Card> | null;
  onTap?: (c: Card) => void;
  wildEights: boolean;
}) {
  const n = cards.length;
  const cw = cardWidth;
  const ch = Math.round(cw * 1.4);
  const mid = (n - 1) / 2;
  const spacing = n > 1 ? Math.max(8, Math.min(cw * 0.66, (width - cw - 24) / (n - 1))) : 0;
  const angleStep = n > 1 ? Math.min(2.5, 18 / (n - 1)) : 0;
  const curve = 0.3;
  const maxDrop = mid * mid * curve;
  const lift = 16;
  return (
    <div className="relative mx-auto w-full" style={{ height: ch + maxDrop + lift + 2 }}>
      {cards.map((c, i) => {
        const d = i - mid;
        const lifted = c === selected;
        const dim = playable !== null && !playable.has(c);
        return (
          <button
            key={c}
            type="button"
            disabled={!onTap}
            onClick={() => onTap?.(c)}
            aria-pressed={lifted}
            aria-label={`${label(c)}${dim ? ' (cannot be played now)' : ''}`}
            className="absolute left-1/2 transition-transform duration-150"
            style={{
              bottom: 2 + maxDrop,
              transform: `translateX(calc(-50% + ${d * spacing}px)) translateY(${d * d * curve - (lifted ? lift : 0)}px) rotate(${d * angleStep}deg)`,
              transformOrigin: 'bottom center',
              zIndex: i,
            }}
          >
            <div
              className={`rounded-[9px] shadow-[0_1px_4px_rgba(0,0,0,.3)] transition ${lifted ? 'outline outline-[3px] outline-lime' : ''} ${dim ? 'brightness-[.6]' : ''}`}
              style={{ width: cw, height: ch }}
            >
              <CardFace card={c} width={cw} star={wildEights && c[0] === '8'} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** An opponent: name, a small fan of card backs (or their cards face-up when the game is over). */
function Seat({ name, count, current, left, revealed, points }: { name: string; count: number; current: boolean; left: boolean; revealed: Card[] | null; points: number | null }) {
  const shown = Math.min(count, 8);
  return (
    <div className={`flex min-w-[5.5rem] flex-col items-center rounded-xl px-2 py-1.5 transition ${current ? 'bg-lime/15 ring-2 ring-lime/70' : 'bg-black/20'} ${left ? 'opacity-40' : ''}`}>
      <div className="flex max-w-[8rem] items-center gap-1 text-[11px] font-bold">
        <span className="truncate">{name}</span>
        <span className="shrink-0 font-normal text-white/60">· {left ? 'left' : count}</span>
      </div>
      {revealed ? (
        <div className="mt-1 flex flex-wrap justify-center gap-0.5">
          {revealed.map((c) => (
            <CardFace key={c} card={c} width={22} compact />
          ))}
          {points !== null && <span className="ml-1 self-center text-[10px] font-bold text-white/70">{points} pts</span>}
        </div>
      ) : (
        <div className="relative mt-1 h-[34px]" style={{ width: 22 + Math.max(0, shown - 1) * 7 }}>
          {Array.from({ length: shown }, (_, i) => (
            <div key={i} className="absolute top-0" style={{ left: i * 7, transform: `rotate(${(i - (shown - 1) / 2) * 4}deg)` }}>
              <CardBack width={22} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TurnBar({ view, serverNow, text }: { view: CrazyView; serverNow: () => number; text: string }) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(t);
  }, [serverNow]);
  const total = view.config.turnSeconds * 1000;
  const left = view.turnDeadline ? Math.max(0, view.turnDeadline - now) : 0;
  const secs = Math.ceil(left / 1000);
  return (
    <div className="mx-auto w-full max-w-md px-4">
      <div className="mb-1 flex items-center justify-between text-xs font-bold">
        <span className="font-ethiopic text-lime">{text}</span>
        <span className="tabular-nums">
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-black/30">
        <div className="h-full rounded-full bg-[linear-gradient(90deg,#2ee67a,#f5c542,#ff6b5a)] transition-[width] duration-200" style={{ width: `${Math.min(100, (left / total) * 100)}%` }} />
      </div>
    </div>
  );
}

function SuitChooser({ card, onPick, onCancel }: { card: Card; onPick: (s: Suit) => void; onCancel: () => void }) {
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-black/60 p-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Choose the next suit">
      <div className="card grid w-full max-w-xs gap-4 p-5 text-center text-fg">
        <div>
          <div className="font-ethiopic text-lg font-extrabold">ቀጣዩን ዓይነት ይምረጡ</div>
          <div className="text-sm text-muted">You played {label(card)} — choose the next suit</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {SUIT_PICK_ORDER.map((s) => (
            <button key={s} onClick={() => onPick(s)} className="flex flex-col items-center rounded-xl border border-line bg-white py-2 transition active:scale-95">
              <span className={`text-4xl leading-none ${red(s) ? 'text-[#c8102e]' : 'text-[#17171c]'}`}>{SUIT_SYMBOL[s]}</span>
              <span className="text-xs font-bold text-[#17171c]">{SUIT_NAME[s]}</span>
            </button>
          ))}
        </div>
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function describe(e: CrazyLastEvent | null, name: (id: string) => string): string | null {
  if (!e) return null;
  const who = name(e.playerId);
  switch (e.kind) {
    case 'play':
      return e.suit ? `${who} played ${label(e.card!)} — the suit is now ${SUIT_SYMBOL[e.suit]}` : `${who} played ${label(e.card!)}`;
    case 'draw':
      return `${who} drew a card`;
    case 'penalty':
      return `${who} picked up ${e.count} cards`;
    case 'pass':
      return `${who} passed`;
    case 'forfeit':
      return `${who} left the game`;
    default:
      return null;
  }
}

export function CrazyTable({ state, view, act, pending, serverNow }: TableProps<CrazyView>) {
  const { user } = useSession();
  const me = view.players.find((p) => p.playerId === user?.id) ?? null;
  const myIndex = view.players.findIndex((p) => p.playerId === user?.id);
  // Opponents in turn order after me.
  const opponents = useMemo(() => {
    const n = view.players.length;
    const start = myIndex < 0 ? 0 : myIndex + 1;
    return Array.from({ length: n }, (_, k) => view.players[(start + k) % n]).filter((p) => p.playerId !== user?.id);
  }, [view.players, myIndex, user?.id]);
  const myTurn = view.currentPlayerId === user?.id;
  const finished = view.phase === 'finished';
  const name = useCallback((id: string) => (id === user?.id ? 'You' : nameOf(state, id)), [state, user?.id]);

  const [order, setOrder] = useState<Card[]>([]);
  const [selected, setSelected] = useState<Card | null>(null);
  const [choosing, setChoosing] = useState<Card | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [handRef, handWidth] = useWidth<HTMLDivElement>();
  const vh = useViewportHeight();
  const cardW = vh < 560 ? 44 : vh < 660 ? 50 : vh < 780 ? 56 : 62;

  // Keep the player's arrangement; newly drawn cards are added on the right.
  useEffect(() => {
    setOrder((prev) => {
      const kept = prev.filter((c) => view.hand.includes(c));
      const added = view.hand.filter((c) => !kept.includes(c));
      return kept.length ? [...kept, ...added] : [...view.hand].sort(bySuitRank);
    });
    setSelected((s) => (s && view.hand.includes(s) ? s : null));
  }, [view.hand]);
  useEffect(() => setChoosing(null), [view.currentPlayerId]);
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 3000);
    return () => clearTimeout(t);
  }, [hint]);

  // Deal animation for a game this client sees from its first move: cards land one at a time, round by round.
  const [deal, setDeal] = useState<{ seq: string[]; start: number } | null>(null);
  const [dealElapsed, setDealElapsed] = useState(0);
  const dealtOnce = useRef(false);
  useEffect(() => {
    if (dealtOnce.current) return;
    dealtOnce.current = true;
    if (view.phase !== 'play' || view.turn !== 1 || view.lastEvent !== null || myIndex < 0) return;
    const size = me?.handCount ?? 0;
    const seq: string[] = [];
    for (let r = 0; r < size; r++) for (const p of [view.players[myIndex], ...opponents]) seq.push(p.playerId);
    setDeal({ seq, start: performance.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!deal) return;
    const t = setInterval(() => setDealElapsed(performance.now() - deal.start), 40);
    return () => clearInterval(t);
  }, [deal]);
  const endDeal = useCallback(() => setDeal(null), []);
  const landed = deal ? deal.seq.slice(0, dealtCount(dealElapsed, deal.seq.length)) : null;
  const dealtTo = (id: string, count: number) => (landed ? Math.min(count, landed.filter((x) => x === id).length) : count);

  const playable = useMemo(() => new Set(view.legal.play), [view.legal.play]);
  const play = (card: Card, suit?: Suit) => {
    setSelected(null);
    setChoosing(null);
    void act({ type: 'play', card, ...(suit ? { suit } : {}) });
  };
  const tryPlay = (card: Card) => {
    if (!playable.has(card)) {
      setHint(view.pendingDraw > 0 ? `Answer with a 2 or draw ${view.pendingDraw}` : `Play a ${SUIT_SYMBOL[view.activeSuit]} card, a ${RANK_LABEL[view.topCard[0] as Rank]} or an 8`);
      return;
    }
    if (card[0] === '8' && view.config.rules.eightsWild) setChoosing(card);
    else play(card);
  };
  // First tap lifts a card; tapping the lifted card plays it.
  const tap = (c: Card) => (selected === c ? tryPlay(c) : setSelected(c));

  const status = describe(view.lastEvent, name);
  const turnText = myTurn
    ? view.pendingDraw > 0
      ? `የእርስዎ ተራ · answer with a 2 or draw ${view.pendingDraw}`
      : 'የእርስዎ ተራ · your turn'
    : `የ${view.currentPlayerId ? nameOf(state, view.currentPlayerId) : ''} ተራ`;
  const suitChanged = view.activeSuit !== view.topCard[1];

  return (
    <div className="felt-pattern fixed inset-0 z-[35] flex flex-col overflow-hidden text-white">
      <Link href="/games/crazy" aria-label="Back to the lobby" className="absolute left-2 top-2 z-[36] grid h-8 w-8 place-items-center rounded-full bg-black/40 text-sm font-bold">
        ←
      </Link>

      {/* Opponents */}
      <div className="flex shrink-0 flex-wrap justify-center gap-1.5 px-11 pt-2">
        {opponents.map((p) => (
          <Seat
            key={p.playerId}
            name={nameOf(state, p.playerId)}
            count={dealtTo(p.playerId, p.handCount)}
            current={p.playerId === view.currentPlayerId}
            left={p.status === 'forfeited'}
            revealed={p.revealedHand}
            points={p.points}
          />
        ))}
      </div>

      {/* Deck and discard */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden px-2">
        <div className="flex items-end justify-center gap-10">
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              disabled={!myTurn || !view.legal.draw || pending}
              onClick={() => void act({ type: 'draw' })}
              className="relative disabled:cursor-default"
              aria-label={view.pendingDraw > 0 ? `Draw ${view.pendingDraw} cards` : `Draw a card (${view.stockCount} left)`}
            >
              <DeckStack count={view.stockCount} active={myTurn && view.legal.draw && playable.size === 0} />
            </button>
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/70">Deck</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="relative">
              <DiscardPile cards={view.discardRecent} count={view.discardCount} active={false} />
              {view.pendingDraw > 0 && (
                <span className="absolute -right-3 -top-2 z-10 animate-pop rounded-full bg-danger px-2 py-0.5 text-sm font-black shadow">+{view.pendingDraw}</span>
              )}
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/70">Pile</span>
          </div>
        </div>
        <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${suitChanged ? 'bg-gold text-[#17171c]' : 'bg-black/40'}`}>
          {suitChanged ? 'Suit changed to' : 'Follow'}
          <span className={`grid h-6 w-6 place-items-center rounded-full bg-white text-base leading-none ${red(view.activeSuit) ? 'text-[#c8102e]' : 'text-[#17171c]'}`}>{SUIT_SYMBOL[view.activeSuit]}</span>
          {!suitChanged && <span className="font-normal text-white/70">or {RANK_LABEL[view.topCard[0] as Rank]}</span>}
        </div>
        {status && <div className="max-w-xs text-center text-[11px] text-white/75">{status}</div>}
      </div>

      {/* Turn and hand */}
      {!finished && (
        <div className="shrink-0 py-1">
          <TurnBar view={view} serverNow={serverNow} text={turnText} />
        </div>
      )}
      {me && (
        <div className="shrink-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="mb-0.5 text-center text-[11px] text-white/70">
            You · {me.status === 'forfeited' ? 'left the game' : `${view.hand.length} cards`}
            {finished && me.points !== null && ` · ${me.points} pts`}
          </div>
          <div ref={handRef} className="mx-auto w-full max-w-xl">
            <HandFan
              cards={deal ? order.slice(0, dealtTo(me.playerId, order.length)) : order}
              width={handWidth}
              cardWidth={cardW}
              selected={selected}
              playable={myTurn ? playable : null}
              onTap={myTurn && !pending && !finished ? tap : undefined}
              wildEights={view.config.rules.eightsWild}
            />
          </div>
          {!finished && me.status === 'active' && (
            <div className="mx-auto mt-1 grid w-full max-w-md grid-cols-4 gap-1 px-2">
              <ActionButton am="ጣል" en="play" onClick={() => selected && tryPlay(selected)} disabled={!myTurn || pending || !selected || !playable.has(selected)} />
              <ActionButton am="ውሰድ" en={view.pendingDraw > 0 && myTurn ? `draw ${view.pendingDraw}` : 'draw'} tone="gold" onClick={() => void act({ type: 'draw' })} disabled={!myTurn || pending || !view.legal.draw} />
              <ActionButton am="እለፍ" en="pass" tone="red" onClick={() => void act({ type: 'pass' })} disabled={!myTurn || pending || !view.legal.pass} />
              <ActionButton am="ደርድር" en="sort" onClick={() => setOrder([...view.hand].sort(bySuitRank))} disabled={view.hand.length === 0} />
            </div>
          )}
        </div>
      )}

      {deal && <ShuffleAndDeal onDone={endDeal} sequence={deal.seq.map((id) => (id === user?.id ? 'me' : 'opp'))} />}
      {choosing && <SuitChooser card={choosing} onPick={(s) => play(choosing, s)} onCancel={() => setChoosing(null)} />}
      {hint && (
        <div className="pointer-events-none absolute inset-x-0 bottom-36 z-40 flex justify-center px-4">
          <div className="animate-pop rounded-xl bg-danger px-4 py-2 text-sm font-semibold">{hint}</div>
        </div>
      )}
    </div>
  );
}
