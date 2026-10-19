'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  arrangeHand,
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
  type Card,
  type ConquerMeldSpec,
  type ConquerMeldView,
  type ConquerPlacedCard,
  type ConquerPrediction,
  type ConquerView,
  type Rank,
} from '@akukulu/shared';
import { useSession } from '@/lib/session';
import { PlayingCard } from '@/components/ui';
import { nameOf, type TableProps } from './types';

/** Order of the prediction buttons, as players know them. */
const PREDICTION_ORDER: ConquerPrediction[] = ['upDown', 'up', 'down', 'side'];
const label = (c: Card) => `${RANK_LABEL[c[0] as Rank]}${SUIT_SYMBOL[c[1] as 's']}`;
const RUN_ORDER = 'A23456789TJQK';
const bySuitRank = (a: Card, b: Card) => 'shdc'.indexOf(a[1]) - 'shdc'.indexOf(b[1]) || RUN_ORDER.indexOf(a[0]) - RUN_ORDER.indexOf(b[0]);

/** Tracks an element's width; the callback ref re-attaches whenever the element mounts. */
function useWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(360);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    observer.current = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    observer.current.observe(el);
  }, []);
  return [ref, width] as const;
}

const HAND_W = 54;
const HAND_H = 78;

/**
 * A card face for a tight fan: rank, suit and joker star are stacked in the
 * top-left corner, the only part of each card that stays visible.
 */
function FanCard({ card, selected, joker, marked }: { card: Card; selected?: boolean; joker?: boolean; marked?: boolean }) {
  const rank = RANK_LABEL[card[0] as Rank];
  const suit = SUIT_SYMBOL[card[1] as 's'];
  const red = card[1] === 'h' || card[1] === 'd';
  return (
    <div
      className={`relative rounded-lg bg-[#fbfaff] shadow-[0_2px_6px_rgba(0,0,0,.45)] ${selected ? 'ring-[3px] ring-lime' : marked ? 'ring-[3px] ring-gold' : 'ring-1 ring-black/10'} ${red ? 'text-[#e0284f]' : 'text-[#16161f]'}`}
      style={{ width: HAND_W, height: HAND_H }}
    >
      <div className="absolute left-[3px] top-[3px] flex w-[17px] flex-col items-center leading-none">
        <span className={`font-black ${rank === '10' ? 'text-[13px] tracking-tighter' : 'text-[16px]'}`}>{rank}</span>
        <span className="text-[14px]">{suit}</span>
        {joker && <span className="mt-0.5 text-[12px] text-[#e3a008]">★</span>}
      </div>
      <span className="absolute bottom-1 right-1.5 text-[26px] leading-none">{suit}</span>
    </div>
  );
}

/** Cards on a shallow arc that always fits its box. `flip` is the opponent's fan at the top. */
function Fan({ cards, width, flip, selected, wild, marked, onTap }: { cards: Card[]; width: number; flip?: boolean; selected?: Card[]; wild?: Set<Card>; marked?: Card | null; onTap?: (c: Card) => void }) {
  const n = cards.length;
  const cw = flip ? 36 : HAND_W;
  const ch = flip ? 48 : HAND_H;
  const mid = (n - 1) / 2;
  const spacing = n > 1 ? Math.max(8, Math.min(cw * 0.62, (width - cw - 32) / (n - 1))) : 0;
  const angleStep = n > 1 ? Math.min(2, 16 / (n - 1)) : 0;
  const curve = flip ? 0.5 : 0.45;
  const maxDrop = mid * mid * curve;
  const lift = 18;
  const height = flip ? ch + 8 : ch + maxDrop + lift + 6;
  return (
    <div className="relative mx-auto w-full overflow-visible" style={{ height }}>
      {cards.map((c, i) => {
        const d = i - mid;
        const drop = d * d * curve;
        const lifted = selected?.includes(c);
        return (
          <button
            key={`${c}-${i}`}
            type="button"
            disabled={!onTap}
            onClick={() => onTap?.(c)}
            aria-pressed={lifted}
            aria-label={c === '??' ? 'Hidden card' : `${label(c)}${wild?.has(c) ? ' (joker)' : ''}`}
            className="absolute left-1/2 transition-transform duration-150"
            style={{
              // Hand: anchored above the bottom by the arc depth, so the outer cards dip without leaving the box.
              ...(flip ? { top: -maxDrop * 0.4 } : { bottom: 6 + maxDrop }),
              transform: `translateX(calc(-50% + ${d * spacing}px)) translateY(${flip ? -drop * 0.4 : drop - (lifted ? lift : 0)}px) rotate(${d * angleStep * (flip ? -1 : 1)}deg)`,
              transformOrigin: flip ? 'top center' : 'bottom center',
              zIndex: i,
            }}
          >
            {c === '??' ? <PlayingCard card="??" size="sm" /> : <FanCard card={c} selected={lifted} joker={wild?.has(c)} marked={c === marked} />}
          </button>
        );
      })}
    </div>
  );
}
/**
 * Small table card with its index in the visible corner. A joker shows the card
 * it stands for, in gold, so the matching natural card can be swapped in.
 */
function MiniCard({ placed, highlight }: { placed: Pick<ConquerPlacedCard, 'card' | 'as' | 'wild'>; highlight?: boolean }) {
  const shown = placed.wild ? placed.as : placed.card;
  const rank = RANK_LABEL[shown[0] as Rank];
  const suit = SUIT_SYMBOL[shown[1] as 's'];
  const red = shown[1] === 'h' || shown[1] === 'd';
  return (
    <div
      className={`relative h-[46px] w-[33px] shrink-0 rounded-md shadow-[0_1px_3px_rgba(0,0,0,.5)] ${placed.wild ? 'bg-[#ffe7a0] ring-2 ring-[#e3a008]' : 'bg-[#fbfaff]'} ${highlight ? 'outline outline-2 outline-lime' : ''} ${red ? 'text-[#e0284f]' : 'text-[#16161f]'}`}
      title={placed.wild ? `Joker (${label(placed.card)}) playing as ${label(placed.as)}` : label(placed.card)}
    >
      <div className="absolute left-[2px] top-[2px] flex w-[14px] flex-col items-center leading-none">
        <span className={`font-black ${rank === '10' ? 'text-[10px] tracking-tighter' : 'text-[12px]'}`}>{rank}</span>
        <span className="text-[11px]">{suit}</span>
        {placed.wild && <span className="text-[9px] text-[#b45309]">★</span>}
      </div>
      <span className="absolute bottom-0.5 right-1 text-[15px] leading-none">{suit}</span>
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
      className={`flex items-center rounded-xl p-1 transition ${onTap ? 'bg-lime/15 ring-1 ring-lime/60' : 'bg-black/20'}`}
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
  const total = (view.phase === 'predict' ? view.config.predictSeconds : view.config.turnSeconds) * 1000;
  const left = view.turnDeadline ? Math.max(0, view.turnDeadline - now) : 0;
  const pct = Math.min(100, (left / total) * 100);
  const secs = Math.ceil(left / 1000);
  return (
    <div className="mx-auto w-full max-w-md px-4">
      <div className="mb-1 flex items-center justify-between text-xs font-bold">
        <span className="font-ethiopic text-lime">{mine ? 'የእርስዎ ተራ' : `የ${nameOf(state, view.currentPlayerId)} ተራ`}</span>
        <span className="tabular-nums text-white">
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-black/30">
        <div className="h-full rounded-full bg-[linear-gradient(90deg,#2ee67a,#f5c542,#ff6b5a)] transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ActionButton({ am, en, onClick, disabled, tone = 'teal' }: { am: string; en: string; onClick: () => void; disabled?: boolean; tone?: 'teal' | 'gold' | 'red' }) {
  const tones = { teal: 'bg-[#1d6b5c]/90 border-[#3fb79c]/50', gold: 'bg-[#6b5a1d]/90 border-[#d8b84a]/50', red: 'bg-[#6b2a1d]/90 border-[#e0705a]/50' };
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`flex min-w-[3.9rem] flex-col items-center rounded-lg border px-2 py-1 text-white shadow transition active:scale-95 disabled:opacity-35 ${tones[tone]}`}>
      <span className="font-ethiopic text-sm font-bold leading-tight">{am}</span>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-white/70">{en}</span>
    </button>
  );
}

export function ConquerTable({ state, view, act, pending, serverNow }: TableProps<ConquerView>) {
  const { user } = useSession();
  const me = view.players.find((p) => p.playerId === user?.id) ?? null;
  const opp = view.players.find((p) => p.playerId !== user?.id) ?? null;
  const oppInfo = state.players.find((p) => p.userId === opp?.playerId);
  const myTurn = view.currentPlayerId === user?.id;
  const wild = useMemo(() => new Set(view.wildCards), [view.wildCards]);
  const meldCtx: MeldContext = useMemo(
    () => ({ wild, rules: view.config.rules, taken: new Set(view.melds.flatMap((m) => m.cards.map((c) => c.as))) }),
    [wild, view.config.rules, view.melds],
  );

  const [order, setOrder] = useState<Card[]>([]);
  const [selected, setSelected] = useState<Card[]>([]);
  const [choice, setChoice] = useState<JokerChoice | null>(null);
  const [confirmBase, setConfirmBase] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [handRef, handWidth] = useWidth<HTMLDivElement>();
  const [oppRef, oppWidth] = useWidth<HTMLDivElement>();

  // Keep the player's own arrangement; newly drawn cards are added on the right.
  useEffect(() => {
    setOrder((prev) => {
      const kept = prev.filter((c) => view.hand.includes(c));
      const added = view.hand.filter((c) => !kept.includes(c));
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
  const canLayOff = myTurn && me?.opened && view.phase === 'meld' && selected.length === 1;

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
    const card = selected[0];
    const fits = view.melds.filter((m) => {
      if (m.ownerId !== user?.id && !view.config.rules.layoffOnOpponentMelds) return false;
      const others = new Set(view.melds.filter((x) => x.id !== m.id).flatMap((x) => x.cards.map((c) => c.as)));
      return layoffOptions(toInterpretation(m), card, { ...meldCtx, taken: others }).length > 0;
    });
    if (fits.length === 0) setHint(`${label(card)} does not fit any meld on the table`);
    else if (fits.length === 1) layOff(fits[0]);
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
      <Link href="/games/conquer" className="absolute left-3 top-3 z-[36] flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs font-bold">
        ← Lobby
      </Link>
      {children}
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
  const oppMelds = view.melds.filter((m) => m.ownerId !== user?.id);
  const myMelds = view.melds.filter((m) => m.ownerId === user?.id);
  const meldTap = (m: ConquerMeldView) =>
    canLayOff && (m.ownerId === user?.id || view.config.rules.layoffOnOpponentMelds) ? () => layOff(m) : undefined;

  return shell(
    <>
      {/* Opponent */}
      <div className="flex flex-col items-center pt-2">
        <div ref={oppRef} className="w-full max-w-md">
          <Fan cards={Array.from({ length: opp?.handCount ?? 0 }, () => '??')} width={oppWidth} flip />
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs font-bold">
          <span className={`h-2 w-2 rounded-full ${oppInfo?.online ? 'bg-lime' : 'bg-white/40'}`} title={oppInfo?.online ? 'Online' : 'Offline'} />
          {oppInfo?.displayName ?? 'Opponent'}
          <span className="font-normal text-white/60">· {opp?.handCount} · {opp?.opened ? 'ገብቷል' : 'አልገባም'}</span>
        </div>
        <div className="mt-1 flex max-h-24 max-w-full flex-wrap justify-center gap-1 overflow-y-auto px-2">
          {oppMelds.map((m) => (
            <MeldRow key={m.id} meld={m} onTap={meldTap(m)} />
          ))}
        </div>
      </div>

      {/* Deck and discard */}
      <div className="flex min-h-0 flex-1 items-center justify-center gap-10">
        <div className="flex flex-col items-center gap-1">
          <div className="relative pt-11">
            {/* The base card lies face-up under the deck; its corner (rank and suit) stays visible. */}
            {view.baseInStock && view.baseCard && (
              <button
                type="button"
                disabled={!view.legal.takeBase || pending}
                onClick={() => setConfirmBase(true)}
                className={`absolute left-1/2 top-0 -translate-x-1/2 rounded-lg disabled:cursor-default ${view.legal.takeBase ? 'ring-2 ring-gold/70' : ''}`}
                aria-label={`Base card ${label(view.baseCard)} — draw it (you must then go out this turn)`}
              >
                <FanCard card={view.baseCard} />
              </button>
            )}
            <button
              type="button"
              disabled={!view.legal.drawStock || pending}
              onClick={() => void act({ type: 'drawStock' })}
              className="relative disabled:cursor-default"
              aria-label={`Draw from the deck (${view.stockCount} left)`}
            >
              <div className={`relative rounded-lg ${view.legal.drawStock ? 'animate-pulseRing' : ''}`}>
                <div className="absolute left-0.5 top-0.5 h-full w-full rounded-lg bg-black/30" />
                <PlayingCard card="??" />
                <span className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 text-[10px] font-bold">{view.stockCount}</span>
              </div>
            </button>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/70">Deck</span>
          {view.prediction && (
            <span className="rounded-full bg-black/50 px-2 py-0.5 font-ethiopic text-[11px] font-bold" title={`Jokers: ${view.wildCards.map(label).join(' ')}`}>
              {CONQUER_PREDICTION_LABEL[view.prediction].am} · ★{view.wildCards.map(label).join(' ')}
            </span>
          )}
        </div>
        <div className="flex flex-col items-center gap-1 pt-11">
          <button
            type="button"
            disabled={!view.legal.takeDiscard || pending}
            onClick={() => void act({ type: 'takeDiscard' })}
            className="relative disabled:cursor-default"
            aria-label="Take the top discard"
          >
            {view.discardCount > 1 && <div className="absolute left-1 top-1 h-[4.5rem] w-[3.25rem] rounded-lg bg-white/30" />}
            {view.discardTop ? (
              <div className={`relative rounded-lg ${view.legal.takeDiscard ? 'ring-2 ring-gold/70' : ''}`}>
                <PlayingCard card={view.discardTop} />
              </div>
            ) : (
              <div className="h-[4.5rem] w-[3.25rem] rounded-lg bg-white/10" />
            )}
          </button>
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/70">Discard {view.discardCount || ''}</span>
        </div>
      </div>

      {/* My melds, turn bar */}
      <div className="flex max-h-24 flex-wrap justify-center gap-1 overflow-y-auto px-2">
        {myMelds.map((m) => (
          <MeldRow key={m.id} meld={m} onTap={meldTap(m)} />
        ))}
      </div>
      {view.phase !== 'roundOver' && view.phase !== 'finished' && (
        <div className="py-2">
          <TurnBar view={view} serverNow={serverNow} state={state} mine={myTurn} />
          {myTurn && !me?.opened && (view.mustOpen || view.openingProgress > 0) && (
            <div className="mx-auto mb-1 w-fit rounded-full border border-gold/60 bg-black/40 px-3 py-1 text-center font-ethiopic text-[11px] font-bold text-gold">
              {view.mustOpen ? 'ከመሬት ካርታ ወስደዋል — ' : ''}
              {view.openingProgress}/{view.config.rules.openingThreshold} (ሚሞላ ካርታ ውረድ · lay down sets to reach {view.config.rules.openingThreshold})
            </div>
          )}
          {myTurn && view.mustFinish && (
            <div className="mx-auto mb-1 w-fit rounded-full border border-danger/70 bg-black/40 px-3 py-1 text-center text-[11px] font-bold text-[#ff9aa9]">
              <span className="font-ethiopic">የመሠረት ካርታ ወስደዋል</span> — meld everything and discard your last card this turn
            </div>
          )}
          <TurnBar view={view} serverNow={serverNow} state={state} mine={myTurn} />
          <div className="mt-1 text-center text-[11px] text-white/70">
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
        <div className="pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div ref={handRef} className="mx-auto w-full max-w-xl">
            <Fan cards={order} width={handWidth} selected={selected} wild={wild} marked={myTurn ? view.pendingPickup : null} onTap={myTurn ? toggle : undefined} />
          </div>
          <div className="mt-1 flex flex-wrap justify-center gap-1.5 px-2">
            <ActionButton am="ገቢ" en="meld" onClick={enter} disabled={!myTurn || pending || view.phase !== 'meld' || selected.length < 3} />
            <ActionButton am="ጨምር" en="open" onClick={addToMeld} disabled={!canLayOff || pending} />
            <ActionButton am="ጆከር መተካት" en="swap joker" tone="gold" onClick={() => swapTarget && void act({ type: 'swapWild', meldId: swapTarget.id, card: selected[0] })} disabled={!view.legal.swapWild || !swapTarget || pending} />
            <ActionButton am="ጣል" en="discard" tone="red" onClick={() => void act({ type: 'discard', card: selected[0] })} disabled={!view.legal.discard || selected.length !== 1 || pending} />
            <ActionButton am="ደርድር" en="best order" onClick={() => setOrder(arrangeHand(view.hand, meldCtx).order)} disabled={view.hand.length === 0} />
          </div>
        </div>
      )}

      {/* Round result */}
      {result && (view.phase === 'roundOver' || view.phase === 'finished') && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/55 p-4">
          <div className="card grid w-full max-w-md gap-3 p-5 text-fg">
            <div className="font-display text-xl font-extrabold">
              {result.winnerId === null ? 'Round drawn' : result.winnerId === user?.id ? 'You won the round!' : `${nameOf(state, result.winnerId)} won the round`}
            </div>
            <div className="text-xs text-muted">
              {result.reason === 'out'
                ? 'Went out by melding every card and discarding the last.'
                : result.reason === 'timeout'
                  ? `${result.winnerId === user?.id ? 'Your opponent' : 'You'} ran out of time.`
                  : result.reason === 'forfeit'
                    ? 'Won by forfeit.'
                    : 'The deck ran out — lower penalty wins.'}
            </div>
            {view.players.map((p) => (
              <div key={p.playerId} className="grid gap-1">
                <div className="flex justify-between text-xs font-bold">
                  <span>{nameOf(state, p.playerId)}</span>
                  <span>Penalty {result.penalties[p.playerId] ?? 0}</span>
                </div>
                <div className="flex flex-wrap -space-x-5">
                  {[...(p.revealedHand ?? [])].sort(bySuitRank).map((c) => (
                    <PlayingCard key={c} card={c} size="sm" />
                  ))}
                </div>
              </div>
            ))}
            {view.phase === 'roundOver' ? (
              <div className="grid grid-cols-2 gap-2">
                <button className="btn-primary" disabled={pending || !view.legal.rematch} onClick={() => void act({ type: 'rematch' })}>
                  {me?.wantsRematch ? 'Waiting…' : opp?.wantsRematch ? 'Accept rematch' : 'Rematch'}
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
