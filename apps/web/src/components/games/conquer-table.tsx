'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CONQUER_PREDICTIONS,
  CONQUER_PREDICTION_LABEL,
  RANK_LABEL,
  SUIT_SYMBOL,
  type Card,
  type ConquerLayoffSpec,
  type ConquerMeldSpec,
  type ConquerMeldView,
  type ConquerPrediction,
  type ConquerView,
  type Rank,
} from '@akukulu/shared';
import { useSession } from '@/lib/session';
import { Avatar, Countdown, PlayingCard } from '@/components/ui';
import { nameOf, type TableProps } from './types';

const RUN_ORDER = 'A23456789TJQK';
const SUIT_ORDER = 'shdc';
const sortHand = (cards: Card[]) =>
  [...cards].sort((a, b) => SUIT_ORDER.indexOf(a[1]) - SUIT_ORDER.indexOf(b[1]) || RUN_ORDER.indexOf(a[0]) - RUN_ORDER.indexOf(b[0]));

const label = (c: Card) => `${RANK_LABEL[c[0] as Rank]}${SUIT_SYMBOL[c[1] as 's']}`;

/** Client-side preview of what a prediction selects (the server is authoritative). */
function previewRanks(base: Card, choice: ConquerPrediction, view: ConquerView): string {
  const p = view.config.rules.prediction;
  const i = RUN_ORDER.indexOf(base[0]);
  const step = (d: number) => {
    const n = i + d;
    if (n >= 0 && n < 13) return RUN_ORDER[n];
    return p.boundary === 'wrap' ? RUN_ORDER[(n + 13) % 13] : base[0];
  };
  const r = (x: string) => RANK_LABEL[x as Rank];
  if (choice === 'up') return `${r(step(1))}s wild`;
  if (choice === 'down') return `${r(step(-1))}s wild`;
  if (choice === 'upDown') return `${r(step(1))}s and ${r(step(-1))}s wild`;
  const colour = p.side === 'sameRank' ? '' : p.side === 'sameRankSameColor' ? ' (same colour)' : ' (other colour)';
  return `${r(base[0])}s${colour} wild`;
}

function PredictionPanel({ view, predicting, onPredict, predictorName, pending }: { view: ConquerView; predicting: boolean; onPredict: (c: ConquerPrediction) => void; predictorName: string; pending: boolean }) {
  return (
    <section className="card grid place-items-center gap-4 p-5 text-center">
      <div className="text-xs font-bold uppercase tracking-widest text-muted">Round {view.round} · wildcard prediction</div>
      <div className="flex items-center gap-4">
        {view.baseCard && <PlayingCard card={view.baseCard} size="lg" />}
        <div className="max-w-[12rem] text-left text-sm text-muted">
          {predicting ? 'This is the base card. Choose which cards become wild for the round.' : `${predictorName} is looking at the base card and choosing the wildcards.`}
        </div>
      </div>
      {predicting && view.baseCard && (
        <div className="grid w-full grid-cols-2 gap-2">
          {CONQUER_PREDICTIONS.map((c) => (
            <button key={c} disabled={pending} onClick={() => onPredict(c)} className="btn-ghost flex-col gap-0.5 py-3">
              <span className="font-ethiopic text-lg font-bold">{CONQUER_PREDICTION_LABEL[c].am}</span>
              <span className="text-xs font-bold">{CONQUER_PREDICTION_LABEL[c].en}</span>
              <span className="text-[10px] font-medium text-muted">{previewRanks(view.baseCard!, c, view)}</span>
            </button>
          ))}
        </div>
      )}
      <p className="text-[10px] text-muted">The base card then returns to the deck, all 52 cards are reshuffled and 14 are dealt to each player.</p>
    </section>
  );
}

function MeldRow({ meld, mine, onTap, active }: { meld: ConquerMeldView; mine: boolean; onTap?: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={!onTap}
      className={`flex items-center gap-1 rounded-xl border p-1.5 text-left transition ${active ? 'border-lime/60 bg-lime/10' : 'border-white/10 bg-black/25'} ${onTap ? 'cursor-pointer hover:border-lime/50' : 'cursor-default'}`}
      aria-label={`${mine ? 'Your' : 'Opponent'} ${meld.kind}, ${meld.points} points`}
    >
      <div className="flex -space-x-5">
        {meld.cards.map((c) => (
          <div key={c.card} className="relative">
            <PlayingCard card={c.card} size="sm" />
            {c.wild && (
              <span className="absolute -bottom-1 left-0 rounded bg-gold px-0.5 text-[8px] font-black text-ink" title={`Wildcard playing as ${label(c.as)}`}>
                ★{label(c.as)}
              </span>
            )}
          </div>
        ))}
      </div>
      <span className="ml-1 text-[10px] font-bold text-muted">{meld.points}</span>
    </button>
  );
}

export function ConquerTable({ state, view, act, pending, serverNow }: TableProps<ConquerView>) {
  const { user } = useSession();
  const meIndex = view.players.findIndex((p) => p.playerId === user?.id);
  const me = meIndex >= 0 ? view.players[meIndex] : null;
  const opp = view.players.find((p) => p.playerId !== user?.id) ?? null;
  const oppInfo = state.players.find((p) => p.userId === opp?.playerId);
  const myTurn = view.currentPlayerId === user?.id;
  const wild = useMemo(() => new Set(view.wildCards), [view.wildCards]);

  const [selected, setSelected] = useState<Card[]>([]);
  const [staged, setStaged] = useState<ConquerMeldSpec[]>([]);
  const [stagedLayoffs, setStagedLayoffs] = useState<ConquerLayoffSpec[]>([]);
  const [pickup, setPickup] = useState(false);

  // Reset local staging whenever the authoritative turn state moves on.
  useEffect(() => {
    setSelected([]);
    setStaged([]);
    setStagedLayoffs([]);
    setPickup(false);
  }, [view.phase, view.currentPlayerId, view.round, view.hand.length]);

  const stagedCards = new Set([...staged.flatMap((m) => m.cards), ...stagedLayoffs.map((l) => l.card)]);
  const pool = sortHand([...view.hand, ...(pickup && view.discardTop ? [view.discardTop] : [])]).filter((c) => !stagedCards.has(c));
  const toggle = (c: Card) => setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));

  const tapMeld = (meld: ConquerMeldView) => {
    if (selected.length !== 1) return;
    const card = selected[0];
    if (!pickup && view.legal.swapWild && meld.cards.some((c) => c.wild && c.as === card)) {
      void act({ type: 'swapWild', meldId: meld.id, card });
      return;
    }
    if (pickup) {
      setStagedLayoffs((l) => [...l, { meldId: meld.id, card }]);
      setSelected([]);
    } else {
      void act({ type: 'layoff', layoffs: [{ meldId: meld.id, card }] });
    }
  };

  const canTapMelds = myTurn && selected.length === 1 && (view.phase === 'meld' || pickup) && !!me?.opened;
  const myMelds = view.melds.filter((m) => m.ownerId === user?.id);
  const oppMelds = view.melds.filter((m) => m.ownerId !== user?.id);
  const wildText = view.wildRanks.length
    ? `${view.wildRanks.map((r) => RANK_LABEL[r]).join(' & ')}${view.wildSuits ? ` (${view.wildSuits.map((s) => SUIT_SYMBOL[s]).join('')})` : ''}`
    : '—';

  if (view.phase === 'predict') {
    return (
      <div className="grid gap-3">
        <PredictionPanel
          view={view}
          predicting={view.legal.predict}
          pending={pending}
          predictorName={nameOf(state, view.predictorId)}
          onPredict={(choice) => void act({ type: 'predict', choice })}
        />
        <Countdown deadline={view.turnDeadline} serverNow={serverNow} total={view.config.predictSeconds} />
      </div>
    );
  }

  const result = view.roundResult;

  return (
    <div className="grid gap-3">
      {/* Opponent */}
      {opp && (
        <section className={`card flex items-center gap-3 px-3 py-2.5 ${view.currentPlayerId === opp.playerId ? 'border-lime/60' : ''}`}>
          <div className="relative">
            <Avatar name={oppInfo?.displayName ?? '?'} photoUrl={oppInfo?.photoUrl} size={36} />
            <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel ${oppInfo?.online ? 'bg-lime' : 'bg-muted'}`} title={oppInfo?.online ? 'Online' : 'Offline'} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{oppInfo?.displayName}</div>
            <div className="text-[11px] text-muted">
              {opp.status === 'left' ? 'Left the table' : oppInfo?.online ? 'Online' : 'Disconnected'} · {opp.opened ? 'Opened' : 'Not opened'} · {opp.roundsWon} round{opp.roundsWon === 1 ? '' : 's'} won
            </div>
          </div>
          <div className="flex -space-x-6" aria-label={`${opp.handCount} cards in hand`}>
            {Array.from({ length: Math.min(opp.handCount, 8) }, (_, i) => (
              <PlayingCard key={i} card="??" size="sm" />
            ))}
          </div>
          <span className="chip">{opp.handCount}</span>
        </section>
      )}

      {/* Round info */}
      <section className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="chip">Round {view.round}</span>
        <span className="chip border-gold/40 text-gold">★ Wild: {wildText}</span>
        {view.baseCard && view.prediction && (
          <span className="chip">
            Base {label(view.baseCard)} · {CONQUER_PREDICTION_LABEL[view.prediction].en} (<span className="font-ethiopic">{CONQUER_PREDICTION_LABEL[view.prediction].am}</span>)
          </span>
        )}
        <span className="chip border-violet/40" title="Some rules await confirmation">Beta rules</span>
      </section>

      {/* Table */}
      <section className="felt grid gap-3 rounded-[2rem] border-4 border-[#3a2a12] p-3">
        <div className="grid gap-1.5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">Opponent melds</div>
          <div className="flex flex-wrap gap-1.5">
            {oppMelds.length === 0 && <span className="text-xs text-white/40">None yet</span>}
            {oppMelds.map((m) => (
              <MeldRow key={m.id} meld={m} mine={false} active={canTapMelds} onTap={canTapMelds && view.config.rules.layoffOnOpponentMelds ? () => tapMeld(m) : undefined} />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-center gap-6 py-1">
          <button
            type="button"
            disabled={!view.legal.drawStock || pending}
            onClick={() => void act({ type: 'drawStock' })}
            className="grid place-items-center gap-1 disabled:cursor-default"
            aria-label="Draw from the stock"
          >
            <div className={view.legal.drawStock ? 'animate-pulseRing rounded-lg' : ''}>
              <PlayingCard card="??" />
            </div>
            <span className="text-[10px] font-bold text-white/70">Stock {view.stockCount}</span>
          </button>
          <button
            type="button"
            disabled={!view.legal.takeDiscard || pending}
            onClick={() => setPickup((p) => !p)}
            className="grid place-items-center gap-1 disabled:cursor-default"
            aria-label="Take the top discard"
          >
            {view.discardTop ? <PlayingCard card={view.discardTop} highlight={pickup} /> : <div className="h-[4.5rem] w-[3.25rem] rounded-lg border border-dashed border-white/20" />}
            <span className="text-[10px] font-bold text-white/70">Discard {view.discardCount}</span>
          </button>
        </div>

        <div className="grid gap-1.5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">Your melds</div>
          <div className="flex flex-wrap gap-1.5">
            {myMelds.length === 0 && <span className="text-xs text-white/40">None yet</span>}
            {myMelds.map((m) => (
              <MeldRow key={m.id} meld={m} mine active={canTapMelds} onTap={canTapMelds ? () => tapMeld(m) : undefined} />
            ))}
          </div>
        </div>
      </section>

      {/* Status */}
      {view.phase !== 'roundOver' && view.phase !== 'finished' && (
        <section className="flex items-center justify-between gap-2 text-xs">
          <div className="font-bold">
            {myTurn
              ? view.phase === 'draw'
                ? pickup
                  ? 'Build melds that use the discard, then tap “Take & meld”'
                  : 'Your turn — draw from the stock or take the discard'
                : view.pendingWild
                  ? `Meld the wildcard ${label(view.pendingWild)} before discarding`
                  : me?.opened
                    ? 'Meld, lay off (select a card, tap a meld) or discard'
                    : `Open with ${view.config.rules.openingThreshold}+ points, or discard`
              : `${nameOf(state, view.currentPlayerId)} is playing`}
          </div>
          <Countdown deadline={view.turnDeadline} serverNow={serverNow} total={view.config.turnSeconds} />
        </section>
      )}

      {/* Staging */}
      {myTurn && (staged.length > 0 || stagedLayoffs.length > 0) && (
        <section className="card grid gap-2 p-3">
          <div className="flex flex-wrap gap-2">
            {staged.map((m, i) => (
              <button key={i} className="flex -space-x-5 rounded-lg border border-lime/40 p-1" onClick={() => setStaged((s) => s.filter((_, j) => j !== i))} title="Tap to unstage">
                {m.cards.map((c) => (
                  <PlayingCard key={c} card={c} size="sm" />
                ))}
              </button>
            ))}
            {stagedLayoffs.map((l) => (
              <button key={l.card} className="chip" onClick={() => setStagedLayoffs((s) => s.filter((x) => x.card !== l.card))}>
                lay off {label(l.card)}
              </button>
            ))}
          </div>
          {pickup ? (
            <button
              className="btn-primary"
              disabled={pending}
              onClick={() => void act({ type: 'takeDiscard', melds: staged, layoffs: stagedLayoffs })}
            >
              Take {view.discardTop ? label(view.discardTop) : ''} &amp; meld
            </button>
          ) : (
            <button className="btn-primary" disabled={pending || staged.length === 0} onClick={() => void act({ type: 'meld', melds: staged })}>
              {me?.opened ? 'Lay down melds' : `Open (${view.config.rules.openingThreshold}+ points)`}
            </button>
          )}
        </section>
      )}

      {/* Round result */}
      {result && (view.phase === 'roundOver' || view.phase === 'finished') && (
        <section className="card grid gap-3 p-4">
          <div className="font-display text-lg font-extrabold">
            {result.winnerId === null ? 'Round drawn' : result.winnerId === user?.id ? 'You won the round!' : `${nameOf(state, result.winnerId)} won the round`}
          </div>
          <div className="text-xs text-muted">
            {result.reason === 'out' ? 'Went out by melding every card and discarding the last.' : result.reason === 'forfeit' ? 'Won by forfeit.' : 'The stock ran out — lower penalty wins.'}
          </div>
          {view.players.map((p) => (
            <div key={p.playerId} className="grid gap-1">
              <div className="flex justify-between text-xs font-bold">
                <span>{nameOf(state, p.playerId)}</span>
                <span>Penalty {result.penalties[p.playerId] ?? 0}</span>
              </div>
              <div className="flex flex-wrap -space-x-4">
                {sortHand(p.revealedHand ?? []).map((c) => (
                  <PlayingCard key={c} card={c} size="sm" />
                ))}
              </div>
            </div>
          ))}
          {view.phase === 'roundOver' && (
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-primary" disabled={pending || !view.legal.rematch} onClick={() => void act({ type: 'rematch' })}>
                {me?.wantsRematch ? 'Waiting for opponent…' : opp?.wantsRematch ? 'Accept rematch' : 'Rematch'}
              </button>
              <button className="btn-ghost" disabled={pending} onClick={() => void act({ type: 'leave' })}>
                Leave table
              </button>
            </div>
          )}
          {view.phase === 'roundOver' && <Countdown deadline={view.turnDeadline} serverNow={serverNow} total={view.config.rematchSeconds} />}
        </section>
      )}

      {/* Hand */}
      {me && view.phase !== 'roundOver' && view.phase !== 'finished' && (
        <section className="card grid gap-2 p-3">
          <div className="flex items-center justify-between text-xs font-bold text-muted">
            <span>
              Your hand · {view.hand.length} card{view.hand.length === 1 ? '' : 's'} · {me.opened ? <span className="text-lime">Opened</span> : 'Not opened'}
            </span>
            <span>{selected.length} selected</span>
          </div>
          <div className="flex flex-wrap gap-1 pt-2">
            {pool.map((c) => {
              const on = selected.includes(c);
              const fromDiscard = pickup && c === view.discardTop;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => myTurn && toggle(c)}
                  className={`relative transition-transform ${on ? '-translate-y-2' : ''} ${fromDiscard ? 'rounded-lg ring-2 ring-gold' : ''}`}
                  aria-pressed={on}
                  aria-label={`${label(c)}${wild.has(c) ? ' (wild)' : ''}`}
                >
                  <PlayingCard card={c} highlight={on} />
                  {wild.has(c) && <span className="absolute right-0.5 top-0.5 text-xs text-gold">★</span>}
                </button>
              );
            })}
          </div>
          {myTurn && (
            <div className="grid grid-cols-3 gap-2">
              <button
                className="btn-ghost"
                disabled={selected.length < 3 || !(view.phase === 'meld' || pickup)}
                onClick={() => {
                  setStaged((s) => [...s, { cards: selected }]);
                  setSelected([]);
                }}
              >
                Group meld
              </button>
              <button className="btn-ghost" disabled={selected.length === 0} onClick={() => setSelected([])}>
                Clear
              </button>
              <button
                className="btn-danger"
                disabled={pending || selected.length !== 1 || !view.legal.discard || pickup || staged.length > 0}
                onClick={() => void act({ type: 'discard', card: selected[0] })}
              >
                Discard
              </button>
            </div>
          )}
        </section>
      )}

      {view.lastEvent && <p className="text-center text-[11px] text-muted">{view.lastEvent.playerId ? `${nameOf(state, view.lastEvent.playerId)} ` : ''}{view.lastEvent.text}</p>}
    </div>
  );
}
