'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  arrangeHand,
  findDobe,
  layoffOptions,
  meldOptions,
  partitionIntoMelds,
  type Interpretation,
  type MeldContext,
} from '@akukulu/engines/dist/conquer/rules';
import {
  CONQUER_PREDICTION_LABEL,
  RANK_LABEL,
  SUIT_SYMBOL,
  cardIdentity,
  isPrintedJoker,
  type Card,
  type ConquerMeldSpec,
  type ConquerMeldView,
  type ConquerPlacedCard,
  type ConquerPrediction,
  type ConquerView,
  type Rank,
} from '@akukulu/shared';
import { useSession } from '@/lib/session';
import { Coin, PlayingCard } from '@/components/ui';
import { CardRain, ShuffleAndDeal, dealtCount } from '@/components/fx';
import { CardBack, CardFace } from '@/components/card-face';
import { ActionButton, DeckStack, DiscardPile, useViewportHeight, useWidth } from './card-table';
import { nameOf, type TableProps } from './types';

/** Order of the prediction buttons, as players know them. */
const PREDICTION_ORDER: ConquerPrediction[] = ['upDown', 'up', 'down', 'side'];
const label = (c: Card) => (isPrintedJoker(c) ? 'Joker' : `${RANK_LABEL[c[0] as Rank]}${SUIT_SYMBOL[c[1] as 's']}`);
const RUN_ORDER = 'A23456789TJQK';
const suitOrder = (c: Card) => (isPrintedJoker(c) ? 9 : 'shdc'.indexOf(c[1]));
const bySuitRank = (a: Card, b: Card) => suitOrder(a) - suitOrder(b) || RUN_ORDER.indexOf(a[0]) - RUN_ORDER.indexOf(b[0]);

/** A hand card: the card face, with selection / picked-up rings and a joker star in the corner. */
function FanCard({ card, selected, joker, marked, width = 54 }: { card: Card; selected?: boolean; joker?: boolean; marked?: boolean; width?: number }) {
  return (
    <div
      className={`rounded-[9px] shadow-[0_1px_4px_rgba(0,0,0,.3)] ${selected ? 'outline outline-[3px] outline-lime' : marked ? 'outline outline-[3px] outline-gold' : ''}`}
      style={{ width, height: Math.round(width * 1.4) }}
    >
      <CardFace card={card} width={width} star={joker} />
    </div>
  );
}

/** A face-up card in the opponent's fan (one of their melds). */
interface FanFace {
  placed: Pick<ConquerPlacedCard, 'card' | 'as' | 'wild'>;
  /** One of your cards can be added to this meld (ጨምር). */
  active: boolean;
}

/** Cards on a shallow arc that always fits its box. `flip` is the opponent's fan at the top. */
function Fan({
  cards,
  width,
  flip,
  selected,
  wild,
  marked,
  onTap,
  faces,
  cardWidth = 54,
  faceWidth = 36,
}: {
  cards: Card[];
  width: number;
  cardWidth?: number;
  /** Card width in an opponent's (flipped) fan. */
  faceWidth?: number;
  flip?: boolean;
  selected?: Card[];
  wild?: Set<Card>;
  marked?: Card | null;
  onTap?: (c: Card) => void;
  faces?: Map<Card, FanFace>;
}) {
  const n = cards.length;
  const cw = flip ? faceWidth : cardWidth;
  const ch = Math.round(cw * 1.4);
  const mid = (n - 1) / 2;
  // Narrow opponent seats (4-player) pack their cards tighter.
  const spacing = n > 1 ? Math.max(flip ? 4 : 8, Math.min(cw * 0.62, (width - cw - (flip ? 8 : 24)) / (n - 1))) : 0;
  const angleStep = n > 1 ? Math.min(2, 16 / (n - 1)) : 0;
  const curve = flip ? 0.5 : 0.3;
  const maxDrop = mid * mid * curve;
  const lift = 14;
  const height = flip ? ch + 8 : ch + maxDrop + lift + 2;
  return (
    <div className="relative mx-auto w-full overflow-visible" style={{ height }}>
      {cards.map((c, i) => {
        const d = i - mid;
        const drop = d * d * curve;
        const lifted = selected?.includes(c);
        const face = faces?.get(c);
        const tappable = flip ? !!face?.active : !!onTap;
        return (
          <button
            key={`${c}-${i}`}
            type="button"
            disabled={!tappable}
            onClick={() => onTap?.(c)}
            aria-pressed={lifted}
            aria-label={c === '??' ? 'Hidden card' : `${label(c)}${wild?.has(c) ? ' (joker)' : ''}`}
            className="absolute left-1/2 transition-transform duration-150"
            style={{
              // Hand: anchored above the bottom by the arc depth, so the outer cards dip without leaving the box.
              ...(flip ? { top: -maxDrop * 0.4 } : { bottom: 2 + maxDrop }),
              transform: `translateX(calc(-50% + ${d * spacing}px)) translateY(${flip ? -drop * 0.4 : drop - (lifted ? lift : 0)}px) rotate(${d * angleStep * (flip ? -1 : 1)}deg)`,
              transformOrigin: flip ? 'top center' : 'bottom center',
              zIndex: i,
            }}
          >
            {c === '??' ? (
              <div className="rounded-[5px] shadow-[0_1px_3px_rgba(0,0,0,.4)]">
                <CardBack width={cw} />
              </div>
            ) : face ? (
              <MiniCard placed={face.placed} highlight={face.active} width={cw} />
            ) : (
              <FanCard card={c} selected={lifted} joker={wild?.has(c)} marked={c === marked} width={cw} />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Small table card with a large corner index. A joker keeps its own face (gold
 * paper, star) and a false joker its JOKER face; a tag above the card names the
 * card it stands for, so the matching card can be swapped in.
 */
function MiniCard({ placed, highlight, width = 34 }: { placed: Pick<ConquerPlacedCard, 'card' | 'as' | 'wild'>; highlight?: boolean; width?: number }) {
  const copy = isPrintedJoker(placed.card) && !placed.wild;
  const stands = placed.wild || copy;
  const red = placed.as[1] === 'h' || placed.as[1] === 'd';
  return (
    <div
      className={`relative shrink-0 rounded-[7px] shadow-[0_1px_3px_rgba(0,0,0,.45)] ${highlight ? 'outline outline-2 outline-lime' : ''}`}
      // No z-index here: the joker card must not cover its neighbour in the meld. Only its tag sits on top.
      style={{ width, height: Math.round(width * 1.4) }}
      title={placed.wild ? `Joker (${label(placed.card)}) playing as ${label(placed.as)}` : copy ? `False joker copying ${label(placed.as)}` : label(placed.card)}
    >
      <CardFace card={placed.card} width={width} compact star={placed.wild} tint={placed.wild ? 'gold' : undefined} />
      {stands && (
        <span
          className={`absolute -top-3 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border px-1 text-[10px] font-black leading-[14px] shadow ${copy ? 'border-violet bg-[#f1ebff]' : 'border-gold bg-[#fff4d1]'} ${red ? 'text-[#c8102e]' : 'text-[#17171c]'}`}
        >
          {label(placed.as)}
        </span>
      )}
    </div>
  );
}

const toInterpretation = (m: ConquerMeldView): Interpretation => ({
  kind: m.kind,
  placed: m.cards.map(({ card, as, wild, points, pos }) => ({ card, as, wild, points, pos })),
  points: m.points,
});

/** What each joker in a reading stands for — sent to the server as the meld's `as` hint. */
const jokerHint = (m: Interpretation): Record<Card, Card> => Object.fromEntries(m.placed.filter((p) => p.wild).map((p) => [p.card, p.as]));

type JokerChoice =
  | { kind: 'meld'; melds: Card[][]; index: number; hints: Record<Card, Card>[]; taken: Set<Card>; options: Interpretation[] }
  | { kind: 'layoff'; meldId: string; card: Card; options: Interpretation[] };

function JokerChooser({ choice, onPick, onCancel }: { choice: JokerChoice; onPick: (m: Interpretation) => void; onCancel: () => void }) {
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="card grid w-full max-w-sm gap-3 p-4 text-fg">
        <div>
          <div className="font-ethiopic text-base font-bold">ጆከሩ የትኛውን ካርድ ይወክል?</div>
          <div className="text-xs text-muted">Choose which card the joker stands for.</div>
        </div>
        {choice.options.map((m) => (
          <button key={m.placed.map((p) => p.as).join()} onClick={() => onPick(m)} className="flex items-center justify-between rounded-xl border border-line bg-black/20 p-2 hover:border-lime/60">
            <div className="flex gap-1">
              {m.placed.map((p) => (
                <MiniCard key={p.card} placed={p} highlight={p.wild} />
              ))}
            </div>
            <span className="text-xs font-bold text-muted">{m.points} pts</span>
          </button>
        ))}
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function MeldRow({ meld, onTap }: { meld: ConquerMeldView; onTap?: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={!onTap}
      className={`flex items-center rounded-xl p-1 transition ${meld.cards.some((p) => p.as !== p.card) ? 'pt-3' : ''} ${onTap ? 'bg-lime/15 ring-1 ring-lime/60' : 'bg-black/20'}`}
      aria-label={`${meld.kind}, ${meld.points} points${onTap ? ' — tap to lay off here' : ''}`}
    >
      <div className="flex -space-x-2.5">
        {meld.cards.map((c) => (
          <MiniCard key={c.card} placed={c} />
        ))}
      </div>
      <span className="ml-1 px-1 text-[10px] font-bold text-white/70">{meld.points}</span>
    </button>
  );
}

function TurnBar({ view, serverNow, state, mine }: { view: ConquerView; serverNow: () => number; state: TableProps<ConquerView>['state']; mine: boolean }) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(t);
  }, [serverNow]);
  // After the turn timer, a grace period (the "time's up" popup) counts down to the hard deadline.
  const grace = view.phase !== 'predict' && view.graceAt !== null && now >= view.graceAt;
  const total = (view.phase === 'predict' ? view.config.predictSeconds : grace ? view.config.graceSeconds : view.config.turnSeconds) * 1000;
  const end = view.phase === 'predict' || grace ? view.turnDeadline : (view.graceAt ?? view.turnDeadline);
  const left = end ? Math.max(0, end - now) : 0;
  const pct = Math.min(100, (left / total) * 100);
  const secs = Math.ceil(left / 1000);
  return (
    <div className="mx-auto w-full max-w-md px-4">
      <div className="mb-1 flex items-center justify-between text-xs font-bold">
        <span className={`font-ethiopic ${grace ? 'text-[#ff9aa9]' : 'text-lime'}`}>
          {grace ? (mine ? 'ጊዜዎ አልቋል · time is up' : `የ${nameOf(state, view.currentPlayerId)} ጊዜ አልቋል · time is up`) : mine ? 'የእርስዎ ተራ' : `የ${nameOf(state, view.currentPlayerId)} ተራ`}
        </span>
        <span className={`tabular-nums ${grace ? 'text-[#ff9aa9]' : 'text-white'}`}>
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-black/30">
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${grace ? 'bg-danger' : 'bg-[linear-gradient(90deg,#2ee67a,#f5c542,#ff6b5a)]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * A ዶቤ win, revealed slowly so everyone sees it: the five pairs and then the set of
 * three peel onto the table one card at a time.
 */
function DobeReveal({ dobe, wild }: { dobe: { pairs: Card[][]; triple: Card[] }; wild: Set<Card> }) {
  const groups = [...dobe.pairs, dobe.triple];
  let n = 0;
  return (
    <div className="rounded-xl bg-gold/10 p-2">
      <div className="mb-1.5 text-center font-ethiopic text-sm font-black text-gold">ዶቤ · five pairs and a set of three</div>
      <div className="flex flex-wrap justify-center gap-2">
        {groups.map((g, gi) => (
          <div key={gi} className={`flex -space-x-2 rounded-lg p-0.5 ${gi === groups.length - 1 ? 'ring-1 ring-gold/60' : ''}`}>
            {g.map((c) => (
              <div key={c} className="fx-peel" style={{ animationDelay: `${0.35 * n++}s` }}>
                <MiniCard placed={{ card: c, as: c, wild: wild.has(c) }} width={30} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Shown to the player whose turn timer ran out: return within the grace period, or give up the round. */
function GracePopup({ view, serverNow, onGiveUp, pending }: { view: ConquerView; serverNow: () => number; onGiveUp: () => void; pending: boolean }) {
  const [now, setNow] = useState(serverNow());
  const [dismissed, setDismissed] = useState<number | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(t);
  }, [serverNow]);
  const { graceAt, turnDeadline } = view;
  if (graceAt === null || turnDeadline === null || now < graceAt || now >= turnDeadline || dismissed === graceAt) return null;
  const secs = Math.ceil((turnDeadline - now) / 1000);
  return (
    <div className="absolute inset-0 z-[41] grid place-items-center bg-black/65 p-6 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-label="Time is up">
      <div className="card grid w-full max-w-sm gap-4 p-5 text-center text-fg">
        <div>
          <div className="font-ethiopic text-xl font-extrabold">ጊዜዎ አልቋል</div>
          <div className="text-sm font-bold">Your time is up</div>
        </div>
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-full border-4 border-danger text-3xl font-black tabular-nums text-danger">{secs}</div>
        <p className="text-sm text-muted">
          Return to the game within <b className="text-fg">{secs} s</b> and finish your turn, or you lose the round.
        </p>
        <button className="btn-primary py-3" onClick={() => setDismissed(graceAt)}>
          <span className="font-ethiopic">ወደ ጨዋታው ተመለስ</span> · Return to game
        </button>
        <button className="rounded-xl bg-danger py-3 font-bold text-white shadow transition active:scale-95 disabled:opacity-50" disabled={pending} onClick={onGiveUp}>
          <span className="font-ethiopic">ተሸንፌያለሁ</span> · Give up this round
        </button>
      </div>
    </div>
  );
}

export function ConquerTable({ state, view, act, pending, serverNow }: TableProps<ConquerView>) {
  const { user } = useSession();
  const me = view.players.find((p) => p.playerId === user?.id) ?? null;
  // Opponents in turn order after me (one in 1v1, three at a 4-player table).
  const opponents = useMemo(() => {
    const n = view.players.length;
    const mine = view.players.findIndex((p) => p.playerId === user?.id);
    return Array.from({ length: n }, (_, k) => view.players[(Math.max(mine, 0) + 1 + k) % n]).filter((p) => p.playerId !== user?.id);
  }, [view.players, user?.id]);
  const myTurn = view.currentPlayerId === user?.id;
  const wild = useMemo(() => new Set(view.wildCards), [view.wildCards]);
  const meldCtx: MeldContext = useMemo(
    () => ({
      wild,
      rules: view.config.rules,
      taken: new Set(view.melds.flatMap((m) => m.cards.map((c) => c.as))),
      // A false joker copies the chosen cards (either deck's copy is the same card).
      falseJokerAs: view.config.rules.wild.printedJokers ? [...new Set(view.wildCards.map(cardIdentity))] : [],
    }),
    [wild, view.config.rules, view.melds, view.wildCards],
  );

  const [order, setOrder] = useState<Card[]>([]);
  const [selected, setSelected] = useState<Card[]>([]);
  const [choice, setChoice] = useState<JokerChoice | null>(null);
  const [confirmBase, setConfirmBase] = useState(false);
  // Shuffle-and-deal plays when this client sees the prediction end (not on a mid-round reconnect).
  // Cards are dealt one at a time, starting with the starter, and appear in each fan as they land.
  // Player ids in the order the cards are dealt: round the table from the starter.
  const [deal, setDeal] = useState<{ seq: string[]; start: number } | null>(null);
  const [dealElapsed, setDealElapsed] = useState(0);
  const prevPhase = useRef(view.phase);
  useEffect(() => {
    if (prevPhase.current === 'predict' && (view.phase === 'meld' || view.phase === 'draw')) {
      const n = view.players.length;
      const start = Math.max(0, view.players.findIndex((p) => p.playerId === view.currentPlayerId));
      const seats = Array.from({ length: n }, (_, k) => view.players[(start + k) % n]);
      const count = (p: (typeof seats)[number]) => (p.playerId === user?.id ? view.hand.length : p.handCount);
      const rounds = Math.max(...seats.map(count));
      const seq: string[] = [];
      for (let r = 0; r < rounds; r++) for (const p of seats) if (r < count(p)) seq.push(p.playerId);
      setDealElapsed(0);
      setDeal({ seq, start: performance.now() });
    }
    prevPhase.current = view.phase;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.phase]);
  useEffect(() => {
    if (!deal) return;
    const t = setInterval(() => setDealElapsed(performance.now() - deal.start), 40);
    return () => clearInterval(t);
  }, [deal]);
  const endDeal = useCallback(() => setDeal(null), []);
  const landed = deal ? deal.seq.slice(0, dealtCount(dealElapsed, deal.seq.length)) : null;
  /** Cards of `id` that have landed so far (all of them once the deal is over). */
  const dealtTo = (id: string | undefined) => (landed ? landed.filter((x) => x === id).length : Infinity);
  const dealtMine = dealtTo(user?.id);
  const vh = useViewportHeight();
  const handCardW = vh < 560 ? 42 : vh < 660 ? 48 : vh < 780 ? 54 : 60;
  const [hint, setHint] = useState<string | null>(null);
  const [handRef, handWidth] = useWidth<HTMLDivElement>();
  const [oppRef, oppWidth] = useWidth<HTMLDivElement>();

  // Keep the player's own arrangement; newly drawn cards are added on the right.
  useEffect(() => {
    setOrder((prev) => {
      const kept = prev.filter((c) => view.hand.includes(c));
      const added = view.hand.filter((c) => !kept.includes(c));
      // A new deal is sorted by suit; drawn cards are added on the right. ደርድር arranges the best order.
      return kept.length ? [...kept, ...added] : [...view.hand].sort(bySuitRank);
    });
    setSelected((s) => s.filter((c) => view.hand.includes(c)));
  }, [view.hand]);

  useEffect(() => setChoice(null), [view.phase, view.currentPlayerId]);
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 3500);
    return () => clearTimeout(t);
  }, [hint]);

  const toggle = (c: Card) => setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));
  const swapTarget = selected.length === 1 ? view.melds.find((m) => m.cards.some((c) => c.wild && c.as === selected[0])) : undefined;
  /** Melds the single selected card can be added to (drives the ጨምር button and meld highlights). */
  const openTargets = useMemo(() => {
    if (!(myTurn && me?.opened && view.phase === 'meld' && selected.length === 1)) return [] as string[];
    const card = selected[0];
    return view.melds
      .filter((m) => {
        if (m.ownerId !== user?.id && !view.config.rules.layoffOnOpponentMelds) return false;
        const others = new Set(view.melds.filter((x) => x.id !== m.id).flatMap((x) => x.cards.map((c) => c.as)));
        return layoffOptions(toInterpretation(m), card, { ...meldCtx, taken: others }).length > 0;
      })
      .map((m) => m.id);
  }, [myTurn, me?.opened, view.phase, view.melds, view.config.rules, selected, meldCtx, user?.id]);
  const canLayOff = openTargets.length > 0;
  /** ዶቤ table: the cards whose discard would leave five identical pairs and a set of three (the server checks again). */
  const dobeDiscards = useMemo(
    () => (view.legal.dobe ? view.hand.filter((c) => findDobe(view.hand.filter((x) => x !== c), meldCtx) !== null) : []),
    [view.legal.dobe, view.hand, meldCtx],
  );

  const sendMelds = (melds: Card[][], hints: Record<Card, Card>[]) => {
    const specs: ConquerMeldSpec[] = melds.map((cards, i) => ({ cards, as: hints[i] }));
    void act({ type: 'meld', melds: specs }).then((r) => r.ok && setSelected([]));
  };

  /** Resolves each meld's joker reading, asking the player whenever there is more than one. */
  const resolveMelds = (melds: Card[][], index: number, hints: Record<Card, Card>[], taken: Set<Card>) => {
    for (let i = index; i < melds.length; i++) {
      const options = meldOptions(melds[i], { ...meldCtx, taken });
      if (options.length === 0) {
        setHint('The selected cards do not form valid sets or runs');
        return;
      }
      if (options.length > 1) {
        setChoice({ kind: 'meld', melds, index: i, hints, taken, options });
        return;
      }
      hints[i] = jokerHint(options[0]);
      taken = new Set([...taken, ...options[0].placed.map((p) => p.as)]);
    }
    setChoice(null);
    sendMelds(melds, hints);
  };

  const enter = () => {
    const melds = partitionIntoMelds(selected, meldCtx);
    if (!melds) {
      setHint('The selected cards do not form valid sets or runs');
      return;
    }
    resolveMelds(melds, 0, [], new Set(meldCtx.taken));
  };

  const layOff = (meld: ConquerMeldView) => {
    if (selected.length !== 1) return;
    const card = selected[0];
    const others = new Set(view.melds.filter((m) => m.id !== meld.id).flatMap((m) => m.cards.map((c) => c.as)));
    const options = layoffOptions(toInterpretation(meld), card, { ...meldCtx, taken: others });
    if (options.length === 0) {
      setHint(`${label(card)} does not fit that meld`);
      return;
    }
    if (options.length > 1) {
      setChoice({ kind: 'layoff', meldId: meld.id, card, options });
      return;
    }
    const as = options[0].placed.find((p) => p.card === card)?.as;
    void act({ type: 'layoff', layoffs: [{ meldId: meld.id, card, as }] }).then((r) => r.ok && setSelected([]));
  };

  /** "Open": add the selected card to the meld it fits (asks which meld when several fit). */
  const addToMeld = () => {
    if (selected.length !== 1) return;
    const fits = view.melds.filter((m) => openTargets.includes(m.id));
    if (fits.length === 1) layOff(fits[0]);
    else setHint('It fits more than one meld — tap the one to add it to');
  };

  const pick = (m: Interpretation) => {
    if (!choice) return;
    if (choice.kind === 'layoff') {
      const as = m.placed.find((p) => p.card === choice.card)?.as;
      setChoice(null);
      void act({ type: 'layoff', layoffs: [{ meldId: choice.meldId, card: choice.card, as }] }).then((r) => r.ok && setSelected([]));
      return;
    }
    const hints = [...choice.hints];
    hints[choice.index] = jokerHint(m);
    resolveMelds(choice.melds, choice.index + 1, hints, new Set([...choice.taken, ...m.placed.map((p) => p.as)]));
  };

  const shell = (children: React.ReactNode) => (
    <div className="felt-pattern fixed inset-0 z-[35] flex flex-col overflow-hidden text-white">
      <Link href="/games/conquer" aria-label="Back to the lobby" className="absolute left-2 top-2 z-[36] grid h-8 w-8 place-items-center rounded-full bg-black/40 text-sm font-bold">
        ←
      </Link>
      {children}
      {deal && <ShuffleAndDeal onDone={endDeal} sequence={deal.seq.map((id) => (id === user?.id ? 'me' : 'opp'))} />}
      {myTurn && (view.phase === 'draw' || view.phase === 'meld') && <GracePopup view={view} serverNow={serverNow} pending={pending} onGiveUp={() => void act({ type: 'giveUp' })} />}
      {choice && <JokerChooser choice={choice} onPick={pick} onCancel={() => setChoice(null)} />}
      {confirmBase && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/60 p-6 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="card grid w-full max-w-sm gap-4 p-5 text-center text-fg">
            <div>
              <div className="text-base font-bold">Are you sure you want to draw the base card?</div>
              <div className="mt-1 font-ethiopic text-sm text-muted">የመሠረት ካርታውን መውሰድ እርግጠኛ ነዎት?</div>
              <div className="mt-2 text-xs text-gold">You must meld everything and finish this turn, or you lose.</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button className="btn-ghost py-3" onClick={() => setConfirmBase(false)}>
                No
              </button>
              <button
                className="btn-primary py-3"
                onClick={() => {
                  setConfirmBase(false);
                  void act({ type: 'takeBase' });
                }}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
      {hint && (
        <div className="pointer-events-none absolute inset-x-0 bottom-32 z-40 flex justify-center px-4">
          <div className="animate-pop rounded-xl bg-danger px-4 py-2 text-sm font-semibold">{hint}</div>
        </div>
      )}
    </div>
  );

  /* ---------------- prediction (blind) ---------------- */
  if (view.phase === 'predict') {
    const choosing = view.legal.predict;
    return shell(
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
        <h1 className="font-ethiopic text-2xl font-bold">{choosing ? 'የጨዋታ ሁኔታ ይምረጡ' : `${nameOf(state, view.predictorId)} የጨዋታ ሁኔታ እየመረጡ ነው…`}</h1>
        <p className="-mt-4 text-xs text-white/70">{choosing ? 'Choose the game mode — the joker card stays hidden until you pick.' : 'Waiting for the joker prediction.'}</p>
        {choosing && (
          <div className="flex flex-wrap justify-center gap-3">
            {PREDICTION_ORDER.map((c) => (
              <button
                key={c}
                disabled={pending}
                onClick={() => void act({ type: 'predict', choice: c })}
                className="rounded-lg border border-[#3fb79c]/50 bg-[#1d6b5c]/80 px-5 py-2.5 font-ethiopic text-base font-bold shadow transition hover:bg-[#23806d] active:scale-95"
              >
                {CONQUER_PREDICTION_LABEL[c].am}
              </button>
            ))}
          </div>
        )}
        <div className="w-full max-w-xs">
          <TurnBar view={view} serverNow={serverNow} state={state} mine={choosing} />
        </div>
      </div>,
    );
  }

  const result = view.roundResult;
  const myMelds = view.melds.filter((m) => m.ownerId === user?.id);
  const meldTap = (m: ConquerMeldView) =>
    openTargets.includes(m.id) ? () => layOff(m) : undefined;
  const blocked = selected.length === 1 && view.undiscardable.includes(selected[0]);
  const many = opponents.length > 1;
  // Each opponent's seat: their melds face-up in their fan, ahead of their hidden cards.
  const seatWidth = many ? Math.max(80, (oppWidth - 8) / opponents.length) : oppWidth;

  return shell(
    <>
      {/* Opponents */}
      <div ref={oppRef} data-deal="opp" className={`mx-auto flex w-full shrink-0 justify-center gap-1 pt-2 ${many ? 'px-10' : 'max-w-md px-8'}`}>
        {opponents.map((o) => {
          const info = state.players.find((p) => p.userId === o.playerId);
          const melds = view.melds.filter((m) => m.ownerId === o.playerId);
          const faces = new Map<Card, FanFace>();
          const meldOf = new Map<Card, ConquerMeldView>();
          for (const m of melds)
            for (const p of m.cards) {
              faces.set(p.card, { placed: p, active: openTargets.includes(m.id) });
              meldOf.set(p.card, m);
            }
          const shown = Math.min(o.handCount, dealtTo(o.playerId));
          const cards: Card[] = [...melds.flatMap((m) => m.cards.map((p) => p.card)), ...Array.from({ length: shown }, () => '??' as Card)];
          const current = o.playerId === view.currentPlayerId;
          return (
            <div
              key={o.playerId}
              className={`flex min-w-0 flex-col items-center rounded-xl pb-1 ${many ? 'flex-1' : 'w-full'} ${many && current ? 'bg-lime/10 ring-1 ring-lime/50' : ''} ${o.out ? 'opacity-40' : ''}`}
            >
              <div className="mb-1 flex max-w-full items-center gap-1.5 text-xs font-bold">
                <span className={`h-2 w-2 shrink-0 rounded-full ${info?.online ? 'bg-lime' : 'bg-white/40'}`} title={info?.online ? 'Online' : 'Offline'} />
                <span className="truncate">{info?.displayName ?? 'Opponent'}</span>
                <span className="shrink-0 font-normal text-white/60">· {o.out ? 'out' : shown}</span>
              </div>
              <div className="w-full pt-3">
                <Fan
                  cards={cards}
                  width={seatWidth}
                  flip
                  faceWidth={many ? 26 : 36}
                  faces={faces}
                  onTap={(c) => {
                    const m = meldOf.get(c);
                    if (m && openTargets.includes(m.id)) layOff(m);
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Table: deck and discard, then my melds — scrolls instead of overlapping. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-2">
        <div className="my-auto flex w-full flex-col items-center gap-2 py-1">
      <div className="flex shrink-0 items-center justify-center gap-10">
        <div className="flex flex-col items-center gap-1">
          <div className="relative pt-10">
            {/* The base card lies face-up under the deck; its corner (rank and suit) stays visible. */}
            {view.baseInStock && view.baseCard && (
              <button
                type="button"
                disabled={!view.legal.takeBase || pending}
                onClick={() => setConfirmBase(true)}
                className={`absolute left-1/2 top-0 -translate-x-1/2 rounded-lg disabled:cursor-default ${view.legal.takeBase ? 'ring-2 ring-gold/70' : ''}`}
                aria-label={`Base card ${label(view.baseCard)} — draw it (you must then go out this turn)`}
              >
                <FanCard card={view.baseCard} width={48} />
              </button>
            )}
            <button
              type="button"
              disabled={!view.legal.drawStock || pending}
              onClick={() => void act({ type: 'drawStock' })}
              className="relative disabled:cursor-default"
              aria-label={`Draw from the deck (${view.stockCount} left)`}
              data-deal="deck"
            >
              <DeckStack count={view.stockCount} active={view.legal.drawStock} />
            </button>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/70">Deck</span>
          {view.prediction && (
            <span className="rounded-full bg-black/50 px-2.5 py-0.5 font-ethiopic text-[11px] font-bold">
              {CONQUER_PREDICTION_LABEL[view.prediction].am}
            </span>
          )}
          {view.config.jokerToGround && (
            <span className="rounded-full bg-gold px-2.5 py-0.5 font-ethiopic text-[11px] font-bold text-[#17171c]" title="Go out with a joker as your last card to win double the stake">
              ጆከር ለመሬት ×2
            </span>
          )}
          {view.config.dobe && (
            <span className="rounded-full bg-gold px-2.5 py-0.5 font-ethiopic text-[11px] font-bold text-[#17171c]" title="Five pairs of identical cards and one set of three, laid down at once, win double">
              ዶቤ ×2
            </span>
          )}
        </div>
        <div className="flex flex-col items-center gap-1 pt-10">
          <button
            type="button"
            disabled={!view.legal.takeDiscard || pending}
            onClick={() => void act({ type: 'takeDiscard' })}
            className="relative disabled:cursor-default"
            aria-label="Take the top discard"
          >
            <DiscardPile cards={view.discardRecent} count={view.discardCount} active={view.legal.takeDiscard} />
          </button>
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/70">Discard {view.discardCount || ''}</span>
        </div>
      </div>
          {myMelds.length > 0 && (
            <div className="flex max-w-full flex-wrap justify-center gap-x-1 gap-y-2.5">
              {myMelds.map((m) => (
                <MeldRow key={m.id} meld={m} onTap={meldTap(m)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Turn bar */}
      {view.phase !== 'roundOver' && view.phase !== 'finished' && (
        <div className="shrink-0 py-1">
          {myTurn && !me?.opened && (view.mustOpen || view.openingProgress > 0) && (
            <div className="mx-auto mb-1 w-fit rounded-full border border-gold/60 bg-black/40 px-3 py-1 text-center font-ethiopic text-[11px] font-bold text-gold">
              {view.mustOpen ? 'ከመሬት ካርታ ወስደዋል — ' : ''}
              {view.openingProgress}/{view.config.rules.openingThreshold} (ሚሞላ ካርታ ውረድ · lay down sets to reach {view.config.rules.openingThreshold})
            </div>
          )}
          {myTurn && view.mustFinish && (
            <div className="mx-auto mb-1 w-fit rounded-full border border-danger/70 bg-black/40 px-3 py-1 text-center text-[11px] font-bold text-[#ff9aa9]">
              <span className="font-ethiopic">{view.mustFinishReason === 'fill' ? 'ካርታ ሞልተዋል' : 'የመሠረት ካርታ ወስደዋል'}</span>
              {view.mustFinishReason === 'fill' ? ' — you filled a meld: go out this turn or lose' : ' — meld everything and discard your last card this turn'}
            </div>
          )}
          {myTurn && blocked && (
            <div className="mx-auto mb-1 w-fit rounded-full border border-gold/60 bg-black/40 px-3 py-1 text-center text-[11px] font-bold text-gold">
              {wild.has(selected[0]) ? 'A joker cannot be discarded — meld it, fill with it or keep it' : `${label(selected[0])} fits a meld on the table — it cannot be discarded`}
            </div>
          )}
          <TurnBar view={view} serverNow={serverNow} state={state} mine={myTurn} />
          <div className="mt-0.5 text-center text-[11px] text-white/70">
            You · {me?.opened ? <span className="text-lime">ገብተዋል (in)</span> : `ለመግባት ${view.config.rules.openingThreshold} ነጥብ (${view.config.rules.openingThreshold} to go in)`}
            {view.pendingWild && <span className="text-gold"> · use your joker {label(view.pendingWild)} before discarding</span>}
            {view.pendingPickup && !myTurn && (
              <div className="text-white/80">
                {nameOf(state, view.currentPlayerId)} picked up {label(view.pendingPickup)}
                {view.mustOpen ? ' and must go in this turn' : ''}
              </div>
            )}
          </div>
        </div>
      )}

      {/* My hand and actions */}
      {me && view.phase !== 'roundOver' && view.phase !== 'finished' && (
        <div className="shrink-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div ref={handRef} data-deal="me" className="mx-auto w-full max-w-xl">
            <Fan
              cards={order.slice(0, dealtMine)}
              width={handWidth}
              cardWidth={handCardW}
              selected={selected}
              wild={wild}
              marked={myTurn ? view.pendingPickup : null}
              onTap={myTurn ? toggle : undefined}
            />
          </div>
          <div className="mx-auto mt-1 grid w-full max-w-md grid-cols-5 gap-1 px-2">
            <ActionButton am="ውረድ" en="meld" onClick={enter} disabled={!myTurn || pending || view.phase !== 'meld' || selected.length < 3} />
            <ActionButton am="ጨምር" en="open" onClick={addToMeld} disabled={!canLayOff || pending} />
            <ActionButton am="ጆከር መተካት" en="swap joker" tone="gold" onClick={() => swapTarget && void act({ type: 'swapWild', meldId: swapTarget.id, card: selected[0] })} disabled={!view.legal.swapWild || !swapTarget || pending} />
            <ActionButton am="ጣል" en="discard" tone="red" onClick={() => void act({ type: 'discard', card: selected[0] })} disabled={!view.legal.discard || selected.length !== 1 || blocked || pending} />
            <ActionButton am="ደርድር" en="best order" onClick={() => setOrder(arrangeHand(view.hand, meldCtx).order)} disabled={view.hand.length === 0} />
          </div>
          {dobeDiscards.length > 0 && (
            <div className="mt-1.5 flex justify-center px-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  // The selected card is the one to discard; with nothing (or a wrong card) selected, ask for one.
                  const card = selected.length === 1 && dobeDiscards.includes(selected[0]) ? selected[0] : dobeDiscards.length === 1 ? dobeDiscards[0] : null;
                  if (card) void act({ type: 'dobe', discard: card });
                  else setHint(`Select the card to discard: ${dobeDiscards.map(label).join(' or ')}`);
                }}
                className="animate-pulseRing rounded-full bg-gold px-6 py-2 font-ethiopic text-lg font-black text-[#17171c] shadow-lg active:scale-95"
              >
                ዶቤ! <span className="font-sans text-xs font-bold">five pairs + a set · double</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Round result */}
      {result && (view.phase === 'roundOver' || view.phase === 'finished') && result.winnerId === user?.id && <CardRain />}
      {result && (view.phase === 'roundOver' || view.phase === 'finished') && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/55 p-4">
          <div className="card grid w-full max-w-md gap-3 p-5 text-fg">
            <div className="font-display text-xl font-extrabold">
              {result.winnerId === null ? 'Round drawn' : result.winnerId === user?.id ? 'You won the round!' : `${nameOf(state, result.winnerId)} won the round`}
            </div>
            <div className="text-xs text-muted">
              {result.reason === 'dobe'
                ? 'ዶቤ — five pairs of identical cards and a set of three: double the stake!'
                : result.reason === 'out' && result.jokerFinish
                ? 'ጆከር ለመሬት — went out with a joker as the last card: double the stake!'
                : result.reason === 'out'
                ? 'Went out by melding every card and discarding the last.'
                : result.reason === 'timeout'
                  ? `${result.winnerId === user?.id ? 'Your opponent' : 'You'} ran out of time.`
                  : result.reason === 'gaveUp'
                    ? `${result.winnerId === user?.id ? 'Your opponent' : 'You'} gave up the round.`
                    : result.reason === 'forfeit'
                      ? 'Won by forfeit.'
                      : 'The deck ran out.'}
            </div>
            {result.dobe && <DobeReveal dobe={result.dobe} wild={wild} />}
            {(() => {
              const stake = view.config.stake;
              // The winner gains `won` (older results have none); each loser loses an equal share of it.
              const gained = result.won ?? stake;
              const lost = Math.round(gained / Math.max(1, view.players.length - 1));
              const amount = result.winnerId === user?.id ? gained : lost;
              const mine = result.winnerId === null ? 0 : result.winnerId === user?.id ? amount : -amount;
              return (
                <div className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-lg font-black ${mine > 0 ? 'bg-lime/15 text-lime' : mine < 0 ? 'bg-danger/15 text-danger' : 'bg-white/5 text-muted'}`}>
                  <Coin className="h-5 w-5" />
                  {stake === 0 ? 'Free round — no points at stake' : mine > 0 ? `You won ${amount.toLocaleString()} points` : mine < 0 ? `You lost ${amount.toLocaleString()} points` : 'Draw — stakes returned'}
                </div>
              );
            })()}
            {view.players.map((p) => {
              const won = result.won ?? view.config.stake;
              const share = Math.round(won / Math.max(1, view.players.length - 1));
              const delta = result.winnerId === null ? 0 : p.playerId === result.winnerId ? won : -share;
              return (
                <div key={p.playerId} className="grid gap-1">
                  <div className="flex justify-between text-xs font-bold">
                    <span>{nameOf(state, p.playerId)}</span>
                    <span className="flex gap-3">

                      <span className={delta > 0 ? 'text-lime' : delta < 0 ? 'text-danger' : 'text-muted'}>
                        {delta > 0 ? '+' : ''}
                        {delta.toLocaleString()}
                      </span>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-0.5">
                    {[...(p.revealedHand ?? [])].sort(bySuitRank).map((c) => (
                      <MiniCard key={c} placed={{ card: c, as: c, wild: false }} />
                    ))}
                  </div>
                </div>
              );
            })}
            {view.phase === 'roundOver' ? (
              <div className="grid grid-cols-2 gap-2">
                <button className="btn-primary" disabled={pending || !view.legal.rematch} onClick={() => void act({ type: 'rematch' })}>
                  {me?.wantsRematch ? 'Waiting…' : opponents.some((o) => o.wantsRematch) ? 'Accept rematch' : 'Rematch'}
                </button>
                <button className="btn-ghost" disabled={pending} onClick={() => void act({ type: 'leave' })}>
                  Leave
                </button>
              </div>
            ) : (
              <Link href="/games/conquer" className="btn-primary">
                Back to lobby
              </Link>
            )}
          </div>
        </div>
      )}
    </>,
  );
}
