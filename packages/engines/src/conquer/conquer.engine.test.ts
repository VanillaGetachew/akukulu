import { describe, expect, it } from 'vitest';
import { CONQUER_PREDICTIONS, DEFAULT_CONQUER_CONFIG, DEFAULT_CONQUER_RULES, HIDDEN_CARD, deckWithJokers, type ConquerConfig, type ConquerRules } from '@akukulu/shared';
import { seededRng, type EngineContext, type EngineResult, type LedgerIntent } from '../core';
import { conquerEngine, conquerInventory, isCompleteDeck, type ConquerState } from './conquer.engine';
import { interpretMeld, openingPoints, penaltyValue, selectWildcards, suggestNaturalMelds, type MeldContext } from './rules';

const NOW = 50_000_000;
const ctx = (now = NOW, seed = 11, balance = 10_000): EngineContext => ({ rng: seededRng(seed), now, balances: { a: balance, b: balance } });
const h = (s: string) => (s ? s.split(' ') : []);
const withRules = (patch: Partial<ConquerRules>): Partial<ConquerConfig> => ({ rules: { ...DEFAULT_CONQUER_RULES, ...patch } });

function expectOk(res: EngineResult<ConquerState> | null): { state: ConquerState; ledger: LedgerIntent[] } {
  if (!res) throw new Error('expected a result');
  if (!res.ok) throw new Error(`expected ok, got ${res.code}: ${res.error}`);
  expect(isCompleteDeck(conquerInventory(res.state))).toBe(true);
  return { state: res.state, ledger: res.ledger };
}

function started(config: Partial<ConquerConfig> = {}, seed = 11) {
  return expectOk(conquerEngine.start([{ playerId: 'a', seat: 0 }, { playerId: 'b', seat: 1 }], { ...DEFAULT_CONQUER_CONFIG, ...config }, ctx(NOW, seed)));
}

const act = (s: ConquerState, id: string, action: Record<string, unknown>, c = ctx()) => conquerEngine.act(s, id, action, c);
const run = (s: ConquerState, id: string, action: Record<string, unknown>) => expectOk(act(s, id, action)).state;

/**
 * A round in the draw phase with chosen hands. `stockTop` is listed top first;
 * every other card goes underneath, so the inventory stays a full deck.
 */
function rigged(opts: { a: string; b: string; stockTop?: string; discard?: string; wild?: string[]; current?: 'a' | 'b'; config?: Partial<ConquerConfig> }): ConquerState {
  let s = started(opts.config).state;
  s = run(s, s.players[s.predictor].playerId, { type: 'predict', choice: 'up' });
  const a = h(opts.a);
  const b = h(opts.b);
  const top = h(opts.stockTop ?? '');
  const discard = h(opts.discard ?? '');
  const used = new Set([...a, ...b, ...top, ...discard]);
  expect(used.size).toBe(a.length + b.length + top.length + discard.length);
  s.players[0].hand = a;
  s.players[1].hand = b;
  s.discard = discard;
  s.stock = [...deckWithJokers().filter((c) => !used.has(c)), ...[...top].reverse()];
  s.wildCards = opts.wild ?? [];
  s.current = opts.current === 'b' ? 1 : 0;
  s.phase = 'draw';
  expect(isCompleteDeck(conquerInventory(s))).toBe(true);
  return s;
}

// Fourteen cards: 3s4s5s6s, KhKdKc, 9h9d9c, 2h3h4h + Qc. Drawing 5h completes 2h-5h.
const WINNING_HAND = '3s 4s 5s 6s Kh Kd Kc 9h 9d 9c 2h 3h 4h Qc';
const FILLER_B = '2c 3c 4c Ac 8d Td Jd 2d 3d 4d 5d 6d 6h 8s';
const WILD_B = 'Ac Ah Ad As 4d 5d Jc Jh Js 6c 7c 2s Td Tc';
const WILDS = ['8s', '8h', '8d', '8c'];

describe('Conquer setup and prediction', () => {
  it('reveals a base card set aside from a shuffled 52-card deck', () => {
    const { state } = started();
    expect(state.phase).toBe('predict');
    expect(state.baseSetAside).toBe(true);
    expect(state.stock).toHaveLength(53); // 54 cards (two printed jokers) minus the base card
    expect(state.baseCard!.startsWith('X')).toBe(false);
    expect(state.players.every((p) => p.hand.length === 0)).toBe(true);
  });

  it('keeps the prediction blind: nobody sees the base card before choosing', () => {
    const { state } = started();
    const predictor = state.players[state.predictor].playerId;
    const other = state.players[1 - state.predictor].playerId;
    expect(conquerEngine.view(state, predictor).baseCard).toBeNull();
    expect(conquerEngine.view(state, other).baseCard).toBeNull();
    expect(JSON.stringify(conquerEngine.view(state, predictor))).not.toContain(`"${state.baseCard}"`);
    expect(conquerEngine.view(state, other).legal.predict).toBe(false);
    expect(act(state, other, { type: 'predict', choice: 'up' })).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(act(state, predictor, { type: 'predict', choice: 'sideways' })).toMatchObject({ ok: false, code: 'BAD_CHOICE' });
  });

  for (const choice of CONQUER_PREDICTIONS) {
    it(`"${choice}" sets the wildcards, deals 14 to the starter and 13 to the predictor, and shows the base card under the stock`, () => {
      const { state } = started();
      const base = state.baseCard!;
      const s = run(state, state.players[state.predictor].playerId, { type: 'predict', choice });
      expect(s.wildCards).toEqual(selectWildcards(base, choice, s.config.rules).cards);
      expect(s.players[1 - s.predictor].hand).toHaveLength(14);
      expect(s.players[s.predictor].hand).toHaveLength(13);
      expect(s.stock).toHaveLength(54 - 27);
      expect(s.stock[0]).toBe(base); // bottom of the stock, face up
      expect(s.discard).toHaveLength(0);
      expect(s.current).toBe(1 - s.predictor);
      expect(s.phase).toBe('meld'); // the starter opens by discarding
      for (const id of ['a', 'b']) expect(conquerEngine.view(s, id)).toMatchObject({ baseCard: base, baseInStock: true });
    });
  }

  it('the starter opens with a discard (no draw); the predictor then draws', () => {
    let s = started().state;
    s = run(s, s.players[s.predictor].playerId, { type: 'predict', choice: 'side' });
    const starter = s.players[s.current];
    const predictor = s.players[1 - s.current];
    expect(act(s, starter.playerId, { type: 'drawStock' })).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
    s = run(s, starter.playerId, { type: 'discard', card: starter.hand[0] });
    expect(s.discard).toEqual([starter.hand[0]]);
    expect(s.players.map((p) => p.hand.length)).toEqual([13, 13]);
    expect(s.phase).toBe('draw');
    s = run(s, predictor.playerId, { type: 'drawStock' });
    expect(s.players[s.predictor].hand).toHaveLength(14);
  });

  it('draws the base card last when the stock runs down', () => {
    let s = started().state;
    s = run(s, s.players[s.predictor].playerId, { type: 'predict', choice: 'up' });
    const base = s.baseCard!;
    s = run(s, s.players[s.current].playerId, { type: 'discard', card: s.players[s.current].hand[0] });
    while (s.stock.length > 1) {
      const id = s.players[s.current].playerId;
      s = run(s, id, { type: 'drawStock' });
      s = run(s, id, { type: 'discard', card: s.players[s.current].hand[0] });
    }
    expect(conquerEngine.view(s, 'a').baseInStock).toBe(true);
    const id = s.players[s.current].playerId;
    s = run(s, id, { type: 'drawStock' });
    expect(s.players[s.current].hand).toContain(base);
    expect(conquerEngine.view(s, 'a').baseInStock).toBe(false);
  });
  it('deals from a freshly shuffled deck rather than the pre-prediction order', () => {
    const { state } = started();
    const before = [...state.stock];
    const s = run(state, state.players[state.predictor].playerId, { type: 'predict', choice: 'down' });
    const dealtOrder = [...s.stock.slice(1), ...s.players[0].hand, ...s.players[1].hand];
    expect(dealtOrder.slice(0, 20)).not.toEqual(before.slice(0, 20));
  });
});

describe('Conquer turn sequence', () => {
  it('draws, then discards, then passes the turn', () => {
    let s = rigged({ a: WINNING_HAND, b: FILLER_B, discard: 'Jc' });
    expect(act(s, 'a', { type: 'discard', card: 'Qc' })).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
    expect(act(s, 'b', { type: 'drawStock' })).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    s = run(s, 'a', { type: 'drawStock' });
    expect(s.players[0].hand).toHaveLength(15);
    expect(act(s, 'a', { type: 'drawStock' })).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
    expect(act(s, 'a', { type: 'discard', card: 'As' })).toMatchObject({ ok: false, code: 'ILLEGAL_DISCARD' });
    s = run(s, 'a', { type: 'discard', card: 'Qc' });
    expect(s.players[0].hand).toHaveLength(14);
    expect(s.discard[s.discard.length - 1]).toBe('Qc');
    expect(s.current).toBe(1);
    expect(s.phase).toBe('draw');
  });

  it('keeps hand + own table cards at 13 after every completed turn', () => {
    let s = rigged({ a: WINNING_HAND.replace(' Qc', ''), b: FILLER_B.replace(' 8s', ''), stockTop: '7c' });
    s = run(s, 'a', { type: 'drawStock' });
    s = run(s, 'a', { type: 'meld', melds: [{ cards: h('Kh Kd Kc') }, { cards: h('9h 9d 9c') }] });
    s = run(s, 'a', { type: 'discard', card: '7c' });
    const view = conquerEngine.view(s, 'a');
    expect(view.hand.length + view.players[0].tableCount).toBe(13);
  });
});

describe('Conquer opening (41 points)', () => {
  const hand = '3s 4s 5s 2s 7h 7d 7c 7s 9h 9d 9c Kh Kd Kc';
  const base = () => run(rigged({ a: hand, b: FILLER_B, stockTop: 'Qc' }), 'a', { type: 'drawStock' });

  it('40 points go down but do not open, and block the discard', () => {
    const s = run(base(), 'a', { type: 'meld', melds: [{ cards: h('3s 4s 5s') }, { cards: h('7h 7d 7c 7s') }] });
    expect(s.players[0].opened).toBe(false);
    expect(s.openingProgress).toBe(40);
    const res = act(s, 'a', { type: 'discard', card: 'Qc' });
    expect(res).toMatchObject({ ok: false, code: 'ILLEGAL_DISCARD' });
    expect(!res.ok && res.error).toMatch(/40\/41/);
    expect(act(s, 'a', { type: 'layoff', layoffs: [{ meldId: s.melds[0].id, card: '2s' }] })).toMatchObject({ ok: false });
  });

  it('builds the opening one set at a time within the turn', () => {
    let s = run(base(), 'a', { type: 'meld', melds: [{ cards: h('Kh Kd Kc') }] });
    expect(s.players[0].opened).toBe(false);
    expect(conquerEngine.view(s, 'a')).toMatchObject({ openingProgress: 30, legal: { discard: false } });
    s = run(s, 'a', { type: 'meld', melds: [{ cards: h('3s 4s 5s') }] });
    expect(s.players[0].opened).toBe(true);
    s = run(s, 'a', { type: 'discard', card: 'Qc' });
    expect(s.current).toBe(1);
    expect(s.openingProgress).toBe(0);
  });

  it('loses the round when a partial opening never reaches 41', () => {
    let s = run(base(), 'a', { type: 'meld', melds: [{ cards: h('Kh Kd Kc') }] });
    s = expectOk(conquerEngine.tick(s, ctx(s.turnDeadline!))).state;
    expect(s.roundResult).toMatchObject({ winnerId: 'b', reason: 'timeout' });
  });
  it('accepts exactly 41 points', () => {
    const s = run(base(), 'a', { type: 'meld', melds: [{ cards: h('2s 3s 4s 5s') }, { cards: h('9h 9d 9c') }] });
    expect(s.players[0].opened).toBe(true);
    expect(s.melds.map((m) => m.placed.reduce((n, p) => n + p.points, 0))).toEqual([14, 27]);
  });

  it('accepts 42 points', () => {
    const s = run(base(), 'a', { type: 'meld', melds: [{ cards: h('3s 4s 5s') }, { cards: h('Kh Kd Kc') }] });
    expect(s.players[0].opened).toBe(true);
  });

  it('rejects invalid melds whatever their claimed value', () => {
    const res = act(base(), 'a', { type: 'meld', melds: [{ cards: h('Kh Kd Kc') }, { cards: h('9h 7d 2s') }], points: 999 });
    expect(res).toMatchObject({ ok: false, code: 'ILLEGAL_MELD' });
  });

  it('rejects cards the player does not hold', () => {
    expect(act(base(), 'a', { type: 'meld', melds: [{ cards: h('Ah Ad Ac') }] })).toMatchObject({ ok: false, code: 'ILLEGAL_MELD' });
  });

  it('allows smaller melds and lay-offs once open', () => {
    let s = run(base(), 'a', { type: 'meld', melds: [{ cards: h('3s 4s 5s') }, { cards: h('Kh Kd Kc') }] });
    s = run(s, 'a', { type: 'meld', melds: [{ cards: h('9h 9d 9c') }] });
    s = run(s, 'a', { type: 'layoff', layoffs: [{ meldId: s.melds[0].id, card: '2s' }] });
    expect(s.melds[0].placed.map((p) => p.as)).toEqual(['2s', '3s', '4s', '5s']);
  });

  it('forbids lay-offs before opening', () => {
    let s = run(base(), 'a', { type: 'meld', melds: [{ cards: h('3s 4s 5s') }, { cards: h('Kh Kd Kc') }] });
    s = run(s, 'a', { type: 'discard', card: 'Qc' });
    s = run(s, 'b', { type: 'drawStock' });
    const res = act(s, 'b', { type: 'layoff', layoffs: [{ meldId: s.melds[0].id, card: '6d' }] });
    expect(res).toMatchObject({ ok: false, code: 'ILLEGAL_MELD' });
  });

  it('does not let melds empty the hand (a final discard is required)', () => {
    let s = rigged({ a: WINNING_HAND.replace(' Qc', ' 5h'), b: FILLER_B, stockTop: '7s' });
    s = run(s, 'a', { type: 'drawStock' });
    const all = [{ cards: h('3s 4s 5s 6s 7s') }, { cards: h('Kh Kd Kc') }, { cards: h('9h 9d 9c') }, { cards: h('2h 3h 4h 5h') }];
    const res = act(s, 'a', { type: 'meld', melds: all });
    expect(!res.ok && res.error).toMatch(/must finish by discarding/);
    const keepOne = run(s, 'a', { type: 'meld', melds: [{ cards: h('3s 4s 5s 6s') }, ...all.slice(1)] });
    expect(keepOne.players[0].hand).toEqual(['7s']);
  });
});

describe('Conquer discard pickup', () => {
  const hand = '3h 4h Kh Kd Kc 9s 9d 9c 2s 6c Jh Ts Js Qs';

  it('before opening, taking the discard means reaching 41 this turn — with any cards', () => {
    let s = rigged({ a: hand, b: FILLER_B, discard: '7c 5h' });
    s = run(s, 'a', { type: 'takeDiscard' });
    expect(s.players[0].hand).toContain('5h');
    expect(s.discard).toEqual(['7c']); // the card underneath is now on top
    expect(conquerEngine.view(s, 'b')).toMatchObject({ pendingPickup: '5h', mustOpen: true });
    expect(conquerEngine.view(s, 'a').legal.discard).toBe(false);
    expect(act(s, 'a', { type: 'discard', card: 'Qs' })).toMatchObject({ ok: false, code: 'ILLEGAL_DISCARD' });
    // The picked-up 5♥ does not have to be used: K K K + 9 9 9 = 57 opens.
    s = run(s, 'a', { type: 'meld', melds: [{ cards: h('Kh Kd Kc') }, { cards: h('9s 9d 9c') }] });
    expect(s.players[0].opened).toBe(true);
    expect(s.players[0].hand).toContain('5h');
    s = run(s, 'a', { type: 'discard', card: '5h' });
    expect(s.current).toBe(1);
  });

  it('after opening, the discard can be taken with no obligation', () => {
    let s = rigged({ a: hand, b: FILLER_B, stockTop: '7s 2h' });
    s = run(s, 'a', { type: 'drawStock' });
    s = run(s, 'a', { type: 'meld', melds: [{ cards: h('Kh Kd Kc') }, { cards: h('9s 9d 9c') }] });
    s = run(s, 'a', { type: 'discard', card: 'Qs' });
    s = run(s, 'b', { type: 'drawStock' });
    s = run(s, 'b', { type: 'discard', card: '2h' });
    s = run(s, 'a', { type: 'takeDiscard' });
    expect(s.mustOpen).toBe(false);
    s = run(s, 'a', { type: 'discard', card: '2h' });
    expect(s.current).toBe(1);
  });
  it('still accepts taking and melding in one action', () => {
    const s = run(rigged({ a: hand, b: FILLER_B, discard: '5h' }), 'a', { type: 'takeDiscard', melds: [{ cards: h('3h 4h 5h') }, { cards: h('Kh Kd Kc') }] });
    expect(s.players[0].opened).toBe(true);
    expect(s.pendingPickup).toBeNull();
  });

  it('loses the round if a player who picked up before opening cannot reach 41 in time', () => {
    let s = rigged({ a: hand, b: FILLER_B, discard: 'As' });
    s = run(s, 'a', { type: 'takeDiscard' });
    s = expectOk(conquerEngine.tick(s, ctx(s.turnDeadline!))).state;
    expect(s.roundResult).toMatchObject({ winnerId: 'b', reason: 'timeout' });
  });

  it('lets an opened player take a discard only to lay it off where it fits', () => {
    let s = rigged({ a: hand, b: FILLER_B.replace('8s', '9h'), stockTop: '7s 2h', discard: 'Ah' });
    s = run(s, 'a', { type: 'drawStock' });
    s = run(s, 'a', { type: 'meld', melds: [{ cards: h('Kh Kd Kc') }, { cards: h('9s 9d 9c') }] });
    s = run(s, 'a', { type: 'discard', card: 'Qs' });
    s = run(s, 'b', { type: 'drawStock' });
    s = run(s, 'b', { type: 'discard', card: '9h' });
    expect(act(s, 'a', { type: 'takeDiscard', layoffs: [{ meldId: s.melds[0].id, card: '9h' }] })).toMatchObject({ ok: false, code: 'ILLEGAL_PICKUP' });
    s = run(s, 'a', { type: 'takeDiscard', layoffs: [{ meldId: s.melds[1].id, card: '9h' }] });
    expect(s.melds[1].placed).toHaveLength(4);
  });
});

describe('Conquer base card', () => {
  it('can be drawn from under the deck, but the player must go out that turn', () => {
    let s = started().state;
    s = run(s, s.players[s.predictor].playerId, { type: 'predict', choice: 'up' });
    const starter = s.players[s.current].playerId;
    s = run(s, starter, { type: 'discard', card: s.players[s.current].hand[0] });
    const id = s.players[s.current].playerId;
    expect(conquerEngine.view(s, id).legal.takeBase).toBe(true);
    s = run(s, id, { type: 'takeBase' });
    expect(s.players[s.current].hand).toContain(s.baseCard);
    expect(conquerEngine.view(s, id)).toMatchObject({ mustFinish: true, baseInStock: false, legal: { discard: false } });
    expect(act(s, id, { type: 'discard', card: s.players[s.current].hand[0] })).toMatchObject({ ok: false, code: 'ILLEGAL_DISCARD' });
    expect(act(s, id, { type: 'drawStock' })).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
    s = expectOk(conquerEngine.tick(s, ctx(s.turnDeadline!))).state;
    expect(s.roundResult).toMatchObject({ reason: 'timeout' });
  });

  it('wins if the player goes out after taking it', () => {
    let s = rigged({ a: WINNING_HAND, b: FILLER_B });
    // Put 5♥ face-up under the deck as the base card: it completes 2♥-5♥.
    s.stock = ['5h', ...s.stock.filter((c) => c !== '5h')];
    s.baseCard = '5h';
    s.baseVisible = true;
    s = run(s, 'a', { type: 'takeBase' });
    s = run(s, 'a', { type: 'meld', melds: [{ cards: h('3s 4s 5s 6s') }, { cards: h('Kh Kd Kc') }, { cards: h('9h 9d 9c') }, { cards: h('2h 3h 4h 5h') }] });
    s = run(s, 'a', { type: 'discard', card: 'Qc' });
    expect(s.roundResult).toMatchObject({ winnerId: 'a', reason: 'out' });
  });

  it('is not available once drawn or after the deck is reshuffled', () => {
    const s = rigged({ a: WINNING_HAND, b: FILLER_B });
    s.baseVisible = false;
    expect(act(s, 'a', { type: 'takeBase' })).toMatchObject({ ok: false, code: 'NO_BASE' });
  });
});

describe('Conquer wildcards on the table', () => {
  it('swaps a natural card for a table wildcard, which must be melded before discarding', () => {
    // 8s/8h/8d/8c are wild. a opens with 5h-6h-[8c as 7h] + Kh Kd Kc + 9s 9d 9c and later swaps 7h in.
    let s = rigged({ a: '5h 6h 8c Kh Kd Kc 9s 9d 9c 7h Qs Qd 2c 3d', b: WILD_B, stockTop: '4s Qh', wild: WILDS });
    s = run(s, 'a', { type: 'drawStock' });
    s = run(s, 'a', { type: 'meld', melds: [{ cards: h('5h 6h 8c') }, { cards: h('Kh Kd Kc') }, { cards: h('9s 9d 9c') }] });
    expect(s.melds[0].placed.map((p) => [p.card, p.as])).toEqual([['5h', '5h'], ['6h', '6h'], ['8c', '7h']]);
    s = run(s, 'a', { type: 'swapWild', meldId: s.melds[0].id, card: '7h' });
    expect(s.melds[0].placed[2]).toMatchObject({ card: '7h', as: '7h', wild: false });
    expect(s.players[0].hand).toContain('8c');
    expect(s.pendingWild).toBe('8c');
    expect(act(s, 'a', { type: 'discard', card: '2c' })).toMatchObject({ ok: false, code: 'ILLEGAL_DISCARD' });
    s = run(s, 'a', { type: 'meld', melds: [{ cards: h('Qs Qd 8c') }] });
    expect(s.pendingWild).toBeNull();
    s = run(s, 'a', { type: 'discard', card: '2c' });
    expect(s.current).toBe(1);
  });

  it('rejects swaps that do not match the represented card', () => {
    let s = rigged({ a: '5h 6h 8c Kh Kd Kc 9s 9d 9c 7d Qs Qd 2c 3d', b: WILD_B, stockTop: '4s', wild: WILDS });
    s = run(s, 'a', { type: 'drawStock' });
    s = run(s, 'a', { type: 'meld', melds: [{ cards: h('5h 6h 8c') }, { cards: h('Kh Kd Kc') }, { cards: h('9s 9d 9c') }] });
    expect(act(s, 'a', { type: 'swapWild', meldId: s.melds[0].id, card: '7d' })).toMatchObject({ ok: false, code: 'ILLEGAL_SWAP' });
  });
});

describe('Conquer round end', () => {
  it('wins by melding everything and discarding the last card, and pays the pot once', () => {
    let s = rigged({ a: WINNING_HAND, b: FILLER_B, stockTop: '5h', config: { stake: 50 } });
    s = run(s, 'a', { type: 'drawStock' });
    s = run(s, 'a', { type: 'meld', melds: [{ cards: h('3s 4s 5s 6s') }, { cards: h('Kh Kd Kc') }, { cards: h('9h 9d 9c') }, { cards: h('2h 3h 4h 5h') }] });
    expect(s.players[0].hand).toEqual(['Qc']);
    const res = expectOk(act(s, 'a', { type: 'discard', card: 'Qc' }));
    s = res.state;
    expect(s.phase).toBe('roundOver');
    expect(s.roundResult).toMatchObject({ winnerId: 'a', reason: 'out' });
    expect(res.ledger).toEqual([expect.objectContaining({ playerId: 'a', amount: 100, key: 'r1:payout:a' })]);
    expect(s.players[1].penalty).toBe(s.players[1].hand.reduce((n, c) => n + penaltyValue(c, new Set(), s.config.rules), 0));
    expect(act(s, 'b', { type: 'drawStock' })).toMatchObject({ ok: false });
  });

  it('shuffles the discard pile (except its top card) back in when the deck runs out', () => {
    let s = rigged({ a: '2s 3s 4s 2h 3h 4h 2d 3d 4d 5c 6c 7c 8c 9c', b: 'Ks Kh Kd Qs Qh Qd Js Jh Jd Ts Th Td 9s 9h', stockTop: '2c' });
    s.stock = ['2c'];
    s.discard = deckWithJokers().filter((c) => !new Set([...s.players[0].hand, ...s.players[1].hand, '2c']).has(c));
    const before = new Set(s.discard);
    s = run(s, 'a', { type: 'drawStock' });
    s = run(s, 'a', { type: 'discard', card: '9c' });
    expect(s.phase).toBe('draw');
    expect(s.current).toBe(1);
    expect(s.discard).toEqual(['9c']);
    expect(new Set(s.stock)).toEqual(before);
    expect(s.reshuffles).toBe(1);
    expect(conquerEngine.view(s, 'b').baseInStock).toBe(false);
    s = run(s, 'b', { type: 'drawStock' });
    expect(s.players[1].hand).toHaveLength(15);
  });

  it('ends on stock exhaustion with the lower-penalty option', () => {
    let s = rigged({ a: '2s 3s 4s 2h 3h 4h 2d 3d 4d 5c 6c 7c 8c 9c', b: 'Ks Kh Kd Qs Qh Qd Js Jh Jd Ts Th Td 9s 9h', stockTop: '2c', config: withRules({ exhaustion: 'lowerPenaltyWins' }) });
    s.stock = ['2c'];
    s.discard = deckWithJokers().filter((c) => !new Set([...s.players[0].hand, ...s.players[1].hand, '2c']).has(c));
    s = run(s, 'a', { type: 'drawStock' });
    s = run(s, 'a', { type: 'discard', card: '9c' });
    expect(s.phase).toBe('roundOver');
    expect(s.roundResult).toMatchObject({ winnerId: 'a', reason: 'exhaustion' });
    expect(s.roundResult!.penalties.a).toBeLessThan(s.roundResult!.penalties.b);
  });

  it('records a draw and refunds stakes when penalties are equal', () => {
    let s = rigged({ a: '2s 3s 4s 5s 6s 7s 8s 2h 3h 4h 5h 6h 7h 9s', b: '2d 3d 4d 5d 6d 7d 8d 2c 3c 4c 5c 6c 7c 9h', stockTop: 'Ts', config: { stake: 30, ...withRules({ exhaustion: 'lowerPenaltyWins' }) } });
    s.stock = ['Ts'];
    s.discard = deckWithJokers().filter((c) => !new Set([...s.players[0].hand, ...s.players[1].hand, 'Ts']).has(c));
    s = run(s, 'a', { type: 'drawStock' });
    const res = expectOk(act(s, 'a', { type: 'discard', card: 'Ts' }));
    expect(res.state.roundResult).toMatchObject({ winnerId: null, reason: 'exhaustion' });
    expect(res.ledger.map((l) => [l.playerId, l.amount])).toEqual([['a', 30], ['b', 30]]);
  });

  it('starts a rematch round with the other predictor once both agree', () => {
    let s = rigged({ a: WINNING_HAND, b: FILLER_B, stockTop: '5h', config: { stake: 10 } });
    const firstPredictor = s.predictor;
    s = run(s, 'a', { type: 'drawStock' });
    s = run(s, 'a', { type: 'meld', melds: [{ cards: h('3s 4s 5s 6s') }, { cards: h('Kh Kd Kc') }, { cards: h('9h 9d 9c') }, { cards: h('2h 3h 4h 5h') }] });
    s = run(s, 'a', { type: 'discard', card: 'Qc' });
    s = run(s, 'a', { type: 'rematch' });
    expect(s.phase).toBe('roundOver');
    const res = expectOk(act(s, 'b', { type: 'rematch' }));
    expect(res.state.round).toBe(2);
    expect(res.state.phase).toBe('predict');
    expect(res.state.predictor).toBe(1 - firstPredictor);
    expect(res.ledger.map((l) => l.key)).toEqual(['r2:stake:a', 'r2:stake:b']);
    expect(res.state.players[0].roundsWon).toBe(1);
  });

  it('closes the table when nobody asks for a rematch, ranking by rounds won', () => {
    let s = rigged({ a: WINNING_HAND, b: FILLER_B, stockTop: '5h' });
    s = run(s, 'a', { type: 'drawStock' });
    s = run(s, 'a', { type: 'meld', melds: [{ cards: h('3s 4s 5s 6s') }, { cards: h('Kh Kd Kc') }, { cards: h('9h 9d 9c') }, { cards: h('2h 3h 4h 5h') }] });
    s = run(s, 'a', { type: 'discard', card: 'Qc' });
    s = expectOk(conquerEngine.tick(s, ctx(s.turnDeadline!))).state;
    expect(s.phase).toBe('finished');
    expect(conquerEngine.placements(s)).toEqual([
      { playerId: 'a', placement: 1, outcome: 'win' },
      { playerId: 'b', placement: 2, outcome: 'loss' },
    ]);
  });
});

describe('Conquer timeouts, leaving and privacy', () => {
  it('the predictor loses the round if the prediction timer runs out', () => {
    const { state } = started();
    const s = expectOk(conquerEngine.tick(state, ctx(state.turnDeadline!))).state;
    expect(s.roundResult).toMatchObject({ winnerId: state.players[1 - state.predictor].playerId, reason: 'timeout' });
    expect(s.phase).toBe('roundOver');
  });

  it('a player whose turn timer runs out loses the round (rematch still possible)', () => {
    let s = rigged({ a: WINNING_HAND, b: FILLER_B, config: { stake: 10 } });
    s.turnDeadline = NOW;
    const res = expectOk(conquerEngine.tick(s, ctx()));
    s = res.state;
    expect(s.roundResult).toMatchObject({ winnerId: 'b', reason: 'timeout' });
    expect(s.phase).toBe('roundOver');
    expect(res.ledger).toEqual([expect.objectContaining({ playerId: 'b', amount: 20 })]);
    expect(conquerEngine.view(s, 'a').legal.rematch).toBe(true);
  });

  it('with timeoutLoses off, auto-plays the turn and forfeits after repeated misses', () => {
    let s = rigged({ a: WINNING_HAND, b: FILLER_B, config: withRules({ timeoutLoses: false }) });
    s.turnDeadline = NOW;
    s = expectOk(conquerEngine.tick(s, ctx())).state;
    expect(s.players[0].hand).toHaveLength(14);
    expect(s.current).toBe(1);
    s.players[1].missedTurns = 2;
    s = expectOk(conquerEngine.tick(s, ctx(s.turnDeadline!))).state;
    expect(s.roundResult).toMatchObject({ winnerId: 'a', reason: 'forfeit' });
    expect(s.phase).toBe('finished');
  });

  it('awards the round to the opponent when a player leaves mid-round', () => {
    const s = run(rigged({ a: WINNING_HAND, b: FILLER_B, config: { stake: 20 } }), 'b', { type: 'leave' });
    expect(s.roundResult).toMatchObject({ winnerId: 'a', reason: 'forfeit' });
    expect(s.phase).toBe('finished');
  });

  it('keeps the base card in the inventory when a player leaves during prediction', () => {
    const { state } = started();
    const s = run(state, 'a', { type: 'leave' });
    expect(s.phase).toBe('finished');
  });

  it('never exposes the opponent hand or stock order', () => {
    const s = rigged({ a: WINNING_HAND, b: FILLER_B });
    const json = JSON.stringify(conquerEngine.view(s, 'a'));
    // The base card is public after prediction, wherever it was reshuffled to.
    for (const c of [...s.players[1].hand, ...s.stock].filter((x) => x !== s.baseCard)) expect(json).not.toContain(`"${c}"`);
    const view = conquerEngine.view(s, 'a');
    expect(view.players[1].handCount).toBe(14);
    expect(view.players[1].revealedHand).toBeNull();
    expect(conquerEngine.view(s, null).hand).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

function bestOpening(hand: string[], meldCtx: MeldContext, threshold: number, keep: number) {
  const melds = suggestNaturalMelds(hand, meldCtx);
  let total = 0;
  const chosen = [];
  for (const m of melds) {
    if (hand.length - chosen.flatMap((c) => c.placed).length - m.placed.length < keep) break;
    chosen.push(m);
    total += openingPoints(m, meldCtx.rules);
  }
  return total >= threshold ? chosen : [];
}

describe('Conquer simulated matches', () => {
  it('plays complete rounds with every card accounted for after every action', () => {
    let outs = 0;
    let timeouts = 0;
    let reshuffles = 0;
    let pickups = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rng = seededRng(seed);
      const c = (now: number): EngineContext => ({ rng, now, balances: { a: 1e6, b: 1e6 } });
      let now = NOW;
      const begun = expectOk(conquerEngine.start([{ playerId: 'a', seat: 0 }, { playerId: 'b', seat: 1 }], { ...DEFAULT_CONQUER_CONFIG, stake: 5 }, c(now)));
      let s = begun.state;
      const ledger: LedgerIntent[] = [...begun.ledger];
      let steps = 0;
      const step = (id: string, action: Record<string, unknown>) => {
        const res = conquerEngine.act(s, id, action, c((now += 1000)));
        if (!res.ok) return false;
        expect(isCompleteDeck(conquerInventory(res.state))).toBe(true);
        ledger.push(...res.ledger);
        s = res.state;
        return true;
      };
      for (let round = 0; round < 2; round++) {
        step(s.players[s.predictor].playerId, { type: 'predict', choice: CONQUER_PREDICTIONS[rng.int(4)] });
        let turns = 0;
        while (s.phase === 'draw' || s.phase === 'meld') {
          if (++steps > 20_000) throw new Error('simulation did not terminate');
          const me = s.players[s.current];
          const id = me.playerId;
          if (++turns > 150) {
            // Two weak bots can reshuffle forever; let the clock decide (the player on turn loses).
            const res = conquerEngine.tick(s, c(s.turnDeadline!));
            s = expectOk(res).state;
            ledger.push(...res!.ok ? res!.ledger : []);
            break;
          }
          if (s.phase === 'draw') {
            // Completed-turn invariant: hand + own table cards = 13.
            const v = conquerEngine.view(s, id);
            expect(v.hand.length + v.players[s.current].tableCount).toBe(13);
            // An opened bot takes the discard when it can lay it straight off.
            const top = s.discard[s.discard.length - 1];
            const took = me.opened && top !== undefined && s.melds.some((m) => step(id, { type: 'takeDiscard', layoffs: [{ meldId: m.id, card: top }] }));
            if (took) pickups++;
            else expect(step(id, { type: 'drawStock' })).toBe(true);
          }
          const meldCtx: MeldContext = { wild: new Set(s.wildCards), rules: s.config.rules, taken: new Set(s.melds.flatMap((m) => m.placed.map((p) => p.as))), falseJokerAs: s.wildCards };
          const melds = bestOpening(s.players[s.current].hand, meldCtx, me.opened ? 0 : s.config.rules.openingThreshold, 1);
          if (melds.length) expect(step(id, { type: 'meld', melds: melds.map((m) => ({ cards: m.placed.map((p) => p.card) })) })).toBe(true);
          if (s.players[s.current].opened) {
            for (const card of [...s.players[s.current].hand]) {
              if (s.players[s.current].hand.length <= 1) break;
              for (const m of s.melds) if (step(id, { type: 'layoff', layoffs: [{ meldId: m.id, card }] })) break;
            }
          }
          const hand = s.players[s.current].hand;
          const discard = hand.reduce((best, x) => (penaltyValue(x, new Set(s.wildCards), s.config.rules) > penaltyValue(best, new Set(s.wildCards), s.config.rules) ? x : best), hand[0]);
          expect(step(id, { type: 'discard', card: discard })).toBe(true);
        }
        expect(s.phase).toBe('roundOver');
        reshuffles += s.reshuffles;
        if (s.roundResult!.reason === 'out') outs++;
        else if (s.roundResult!.reason === 'timeout') timeouts++;
        for (const m of s.melds) {
          const check = interpretMeld(m.placed.map((p) => p.card), { wild: new Set(s.wildCards), rules: s.config.rules, taken: new Set(), falseJokerAs: s.wildCards });
          expect(check.ok).toBe(true);
        }
        if (round === 0) {
          step('a', { type: 'rematch' });
          step('b', { type: 'rematch' });
          expect(s.round).toBe(2);
        }
      }
      step('a', { type: 'leave' });
      expect(s.phase).toBe('finished');
      const net = ledger.reduce((n, l) => n + l.amount, 0);
      expect(net).toBe(0);
      expect(new Set(ledger.map((l) => l.key)).size).toBe(ledger.length);
    }
    expect(outs + timeouts).toBe(80);
    expect(outs).toBeGreaterThan(0);
    expect(reshuffles).toBeGreaterThan(0);
    expect(pickups).toBeGreaterThan(0);
  });
});
