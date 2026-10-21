import { describe, expect, it } from 'vitest';
import { CONQUER_PREDICTIONS, DEFAULT_CONQUER_CONFIG, cardIdentity, doubleDeckWithJokers, type ConquerConfig } from '@akukulu/shared';
import { seededRng, type EngineContext, type EngineResult, type LedgerIntent } from '../core';
import { conquerEngine, conquerInventory, isCompleteDeck, type ConquerState } from './conquer.engine';
import { findDobe, interpretMeld, penaltyValue, suggestNaturalMelds, type MeldContext } from './rules';

const NOW = 50_000_000;
const IDS = ['a', 'b', 'c', 'd'];
const ctx = (now = NOW, seed = 11, balance = 10_000): EngineContext => ({ rng: seededRng(seed), now, balances: Object.fromEntries(IDS.map((id) => [id, balance])) });
const h = (s: string) => (s ? s.split(' ') : []);
const FOUR: ConquerConfig = { ...DEFAULT_CONQUER_CONFIG, players: 4 };

const whole = (s: ConquerState) => isCompleteDeck(conquerInventory(s), true, 2);

function expectOk(res: EngineResult<ConquerState> | null): { state: ConquerState; ledger: LedgerIntent[] } {
  if (!res) throw new Error('expected a result');
  if (!res.ok) throw new Error(`expected ok, got ${res.code}: ${res.error}`);
  expect(whole(res.state)).toBe(true);
  return { state: res.state, ledger: res.ledger };
}

function started(config: Partial<ConquerConfig> = {}, seed = 11) {
  return expectOk(conquerEngine.start(IDS.map((playerId, seat) => ({ playerId, seat })), { ...FOUR, ...config }, ctx(NOW, seed)));
}
const act = (s: ConquerState, id: string, action: Record<string, unknown>) => conquerEngine.act(s, id, action, ctx());
const run = (s: ConquerState, id: string, action: Record<string, unknown>) => expectOk(act(s, id, action)).state;

/** Predicted, in the starter's meld phase. */
function dealt(config: Partial<ConquerConfig> = {}, seed = 11) {
  const begun = started(config, seed);
  const s = run(begun.state, begun.state.players[begun.state.predictor].playerId, { type: 'predict', choice: 'up' });
  return { s, ledger: begun.ledger };
}

/** Puts exactly `cards` into seat `index`'s hand, swapping them with wherever they were (counts stay the same). */
function give(s: ConquerState, index: number, cards: string[]) {
  const hand = s.players[index].hand;
  expect(hand).toHaveLength(cards.length);
  const piles = [s.stock, s.discard, ...s.players.map((p) => p.hand)];
  const outgoing = hand.filter((c) => !cards.includes(c));
  for (const c of cards) {
    if (hand.includes(c)) continue;
    const pile = piles.find((p) => p !== hand && p.includes(c))!;
    pile[pile.indexOf(c)] = outgoing.pop()!;
  }
  s.players[index].hand = [...cards];
  expect(whole(s)).toBe(true);
}

describe('4-player Conquer: two decks', () => {
  it('deals from 108 cards: the starter (after the predictor) gets 14, the others 13, both copies of each joker are wild', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { s } = dealt({}, seed);
      expect(conquerInventory(s)).toHaveLength(108);
      const starter = (s.predictor + 1) % 4;
      expect(s.current).toBe(starter);
      s.players.forEach((p, i) => expect(p.hand).toHaveLength(i === starter ? 14 : 13));
      expect(s.stock).toHaveLength(108 - 53);
      for (const w of s.wildCards.filter((c) => c.length === 2)) expect(s.wildCards).toContain(`${w}2`);
    }
  });

  it('plays a card from either deck as itself in melds, but a set never takes the same suit twice', () => {
    const c: MeldContext = { wild: new Set(), rules: DEFAULT_CONQUER_CONFIG.rules, taken: new Set() };
    const runMeld = interpretMeld(h('9h Th2 Jh'), c);
    expect(runMeld.ok && runMeld.meld.placed.map((p) => p.as)).toEqual(['9h', 'Th', 'Jh']);
    expect(interpretMeld(h('Th Th2 Ts'), c).ok).toBe(false);
    expect(interpretMeld(h('Th2 Ts Tc2'), c).ok).toBe(true);
  });

  it('takes turns round the table, and the predictor moves on each round', () => {
    let { s } = dealt();
    const order: number[] = [s.current];
    for (let k = 0; k < 4; k++) {
      const id = s.players[s.current].playerId;
      if (s.phase === 'draw') s = run(s, id, { type: 'drawStock' });
      const v = conquerEngine.view(s, id);
      s = run(s, id, { type: 'discard', card: v.hand.find((x) => !v.undiscardable.includes(x)) });
      order.push(s.current);
    }
    expect(order).toEqual([0, 1, 2, 3, 0].map((k) => (order[0] + k) % 4));
    const firstPredictor = s.predictor;
    s = run(s, s.players[s.current].playerId, { type: 'giveUp' });
    s = run(s, s.players[s.current].playerId, { type: 'giveUp' });
    s = run(s, s.players[s.current].playerId, { type: 'giveUp' });
    expect(s.phase).toBe('roundOver');
    for (const id of IDS) s = run(s, id, { type: 'rematch' });
    expect(s.predictor).toBe((firstPredictor + 1) % 4);
  });

  it('a timeout or giving up only puts that player out; the last one in wins all four stakes', () => {
    let { s, ledger } = dealt({ stake: 20 });
    expect(ledger.filter((l) => l.amount === -20)).toHaveLength(4);
    const first = s.current;
    s = expectOk(conquerEngine.tick(s, ctx(s.turnDeadline!))).state;
    expect(s.players[first].out).toBe(true);
    expect(s.players[first].hand).toEqual([]);
    expect(s.phase).toBe('draw');
    expect(s.current).toBe((first + 1) % 4);
    expect(act(s, s.players[first].playerId, { type: 'rematch' })).toMatchObject({ ok: false });
    // The next two give up; the fourth wins the pot.
    s = run(s, s.players[s.current].playerId, { type: 'giveUp' });
    const res = expectOk(act(s, s.players[s.current].playerId, { type: 'giveUp' }));
    const winner = (first + 3) % 4;
    expect(res.state.roundResult).toMatchObject({ winnerId: IDS[winner], reason: 'gaveUp', won: 60 });
    expect(res.ledger).toEqual([expect.objectContaining({ playerId: IDS[winner], amount: 80, type: 'payout' })]);
  });

  it('leaving puts the player out and the others finish the round, then the table closes', () => {
    let { s } = dealt();
    const leaver = s.players[s.current].playerId;
    s = run(s, leaver, { type: 'leave' });
    expect(s.phase).toBe('draw');
    expect(s.players.find((p) => p.playerId === leaver)).toMatchObject({ status: 'left', out: true });
    s = run(s, s.players[s.current].playerId, { type: 'giveUp' });
    s = run(s, s.players[s.current].playerId, { type: 'giveUp' });
    expect(s.phase).toBe('roundOver');
    expect(conquerEngine.view(s, s.players.find((p) => p.status === 'active')!.playerId).legal.rematch).toBe(false);
    s = expectOk(conquerEngine.tick(s, ctx(s.turnDeadline!))).state;
    expect(s.phase).toBe('finished');
  });
});

describe('4-player Conquer: ዶቤ', () => {
  // Five identical pairs + a three-card run, and the card to discard.
  const DOBE = h('2h 2h2 4c 4c2 9s 9s2 Kd Kd2 7h 7h2 5s 6s 7s Qc');

  function dobeTable(config: Partial<ConquerConfig> = { dobe: true }, hand = DOBE, wild: string[] = []) {
    const { s, ledger } = dealt(config);
    s.wildCards = wild;
    give(s, s.current, hand);
    return { s, ledger, id: s.players[s.current].playerId };
  }

  it('recognises five identical pairs plus a three-card meld', () => {
    const c: MeldContext = { wild: new Set(), rules: DEFAULT_CONQUER_CONFIG.rules, taken: new Set() };
    expect(findDobe(DOBE.slice(0, 13), c)).toMatchObject({ triple: expect.arrayContaining(['5s', '6s', '7s']) });
    // Pairs must be the same card: 7♥ and 7♦ are not a pair.
    expect(findDobe(h('2h 2h2 4c 4c2 9s 9s2 Kd Kd2 7h 7d 5s 6s 7s'), c)).toBeNull();
    // A real joker fills one card of a pair, never both.
    const withJoker: MeldContext = { ...c, wild: new Set(['3d', '3d2']) };
    expect(findDobe(h('2h 2h2 4c 4c2 9s 9s2 Kd Kd2 7h 3d 5s 6s 7s'), withJoker)).not.toBeNull();
    expect(findDobe(h('2h 2h2 4c 4c2 9s 9s2 Kd Kd2 3d 3d2 5s 6s 7s'), withJoker)).not.toBeNull(); // 3♦ 3♦: a pair of the same card
    expect(findDobe(h('2h 2h2 4c 4c2 9s 9s2 Kd Kd2 7h 7d 5s 6s 3d'), withJoker)).toBeNull();
  });

  it('wins double straight from the hand: no 41 needed, everything goes down at once', () => {
    const { s, id } = dobeTable({ dobe: true, stake: 50 });
    expect(s.players[s.current].opened).toBe(false);
    expect(conquerEngine.view(s, id).legal.dobe).toBe(true);
    const res = expectOk(act(s, id, { type: 'dobe', discard: 'Qc' }));
    expect(res.state.phase).toBe('roundOver');
    expect(res.state.roundResult).toMatchObject({ winnerId: id, reason: 'dobe', won: 300 });
    expect(res.state.roundResult!.dobe!.pairs).toHaveLength(5);
    expect(res.state.discard[res.state.discard.length - 1]).toBe('Qc');
    // The pot (4 × 50), the winner's held stake back, and every loser's held stake.
    expect(res.ledger.map((l) => [l.playerId, l.amount])).toEqual([
      [id, 200],
      [id, 50],
      [id, 50],
      [id, 50],
      [id, 50],
    ]);
  });

  it('a joker can fill a pair', () => {
    const hand = h('2h 2h2 4c 4c2 9s 9s2 Kd Kd2 7h 3d 5s 6s 7s Qc');
    const { s, id } = dobeTable({ dobe: true }, hand, ['3d', '3d2']);
    expect(act(s, id, { type: 'dobe', discard: 'Qc' })).toMatchObject({ ok: true });
  });

  it('rejects a hand that is not a ዶቤ, and tables without ዶቤ', () => {
    const { s, id } = dobeTable({ dobe: true }, h('2h 2h2 4c 4c2 9s 9s2 Kd Kd2 7h 7d 5s 6s 7s Qc'));
    expect(act(s, id, { type: 'dobe', discard: 'Qc' })).toMatchObject({ ok: false, code: 'ILLEGAL_DOBE' });
    const plain = dobeTable({});
    expect(act(plain.s, plain.id, { type: 'dobe', discard: 'Qc' })).toMatchObject({ ok: false, code: 'NO_DOBE' });
  });

  it('holds the second stake for ዶቤ tables and returns it on a normal win', () => {
    const { s, ledger } = dealt({ dobe: true, stake: 50 });
    expect(ledger.filter((l) => l.key.includes(':hold:'))).toHaveLength(4);
    let t = s;
    t = run(t, t.players[t.current].playerId, { type: 'giveUp' });
    t = run(t, t.players[t.current].playerId, { type: 'giveUp' });
    const res = expectOk(act(t, t.players[t.current].playerId, { type: 'giveUp' }));
    // Four held stakes come back; only the normal pot moves.
    expect(res.ledger.filter((l) => l.key.includes(':release:'))).toHaveLength(4);
    expect(res.state.roundResult!.won).toBe(150);
  });

  it('ዶቤ is 4-player only and cannot be combined with ጆከር ለመሬት', () => {
    expect(() => conquerEngine.parseConfig({ dobe: true }, 50)).toThrow(/4-player/);
    expect(() => conquerEngine.parseConfig({ players: 4, dobe: true, jokerToGround: true }, 50)).toThrow(/cannot both/);
    expect(() => conquerEngine.parseConfig({ players: 3 }, 50)).toThrow();
    expect(conquerEngine.playerLimits(conquerEngine.parseConfig({ players: 4, jokerToGround: true }, 50))).toEqual({ min: 4, max: 4 });
    expect(conquerEngine.start(IDS.map((playerId, seat) => ({ playerId, seat })), { ...FOUR, stake: 50, dobe: true }, ctx(NOW, 11, 99))).toMatchObject({ ok: false });
  });
});

describe('4-player Conquer simulated rounds', () => {
  it('plays rounds to the end with all 108 cards accounted for after every action', () => {
    let rounds = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const rng = seededRng(seed * 7);
      const c = (now: number): EngineContext => ({ rng, now, balances: Object.fromEntries(IDS.map((id) => [id, 1e6])) });
      let now = NOW;
      const begun = expectOk(conquerEngine.start(IDS.map((playerId, seat) => ({ playerId, seat })), { ...FOUR, stake: 5 }, c(now)));
      let s = begun.state;
      const ledger: LedgerIntent[] = [...begun.ledger];
      const step = (id: string, action: Record<string, unknown>) => {
        const res = conquerEngine.act(s, id, action, c((now += 1000)));
        if (!res.ok) return false;
        expect(whole(res.state)).toBe(true);
        ledger.push(...res.ledger);
        s = res.state;
        return true;
      };
      for (let round = 0; round < 2; round++) {
        step(s.players[s.predictor].playerId, { type: 'predict', choice: CONQUER_PREDICTIONS[rng.int(4)] });
        let turns = 0;
        while (s.phase === 'draw' || s.phase === 'meld') {
          const me = s.players[s.current];
          const id = me.playerId;
          if (++turns > 400) {
            // Weak bots can circle forever: let the clock put players out until one is left.
            const res = conquerEngine.tick(s, c(s.turnDeadline!));
            s = expectOk(res).state;
            if (res!.ok) ledger.push(...res!.ledger);
            continue;
          }
          if (rng.int(150) === 0) {
            step(id, { type: 'giveUp' });
            continue;
          }
          if (s.phase === 'draw') expect(step(id, { type: 'drawStock' })).toBe(true);
          const ctxM: MeldContext = { wild: new Set(s.wildCards), rules: s.config.rules, taken: new Set(), falseJokerAs: [...new Set(s.wildCards.map(cardIdentity))] };
          const melds = suggestNaturalMelds(me.hand, ctxM);
          let total = 0;
          const chosen = [];
          for (const m of melds) {
            if (me.hand.length - m.placed.length - chosen.flatMap((x) => x.placed).length < 1) break;
            chosen.push(m);
            total += m.points;
          }
          if (chosen.length && (me.opened || total >= s.config.rules.openingThreshold)) {
            step(id, { type: 'meld', melds: chosen.map((m) => ({ cards: m.placed.map((p) => p.card) })) });
          }
          const v = conquerEngine.view(s, id);
          if (!v.legal.discard) {
            const res = conquerEngine.tick(s, c(s.turnDeadline!));
            s = expectOk(res).state;
            if (res!.ok) ledger.push(...res!.ledger);
            continue;
          }
          const allowed = v.hand.filter((x) => !v.undiscardable.includes(x));
          const discard = allowed.reduce((best, x) => (penaltyValue(x, new Set(s.wildCards), s.config.rules) > penaltyValue(best, new Set(s.wildCards), s.config.rules) ? x : best), allowed[0]);
          expect(step(id, { type: 'discard', card: discard })).toBe(true);
        }
        expect(s.phase).toBe('roundOver');
        // Simple bots rarely go out in a 4-player hand; most rounds end by the clock or giving up.
        rounds++;
        expect(['out', 'timeout', 'gaveUp', 'exhaustion']).toContain(s.roundResult!.reason);
        if (round === 0) for (const id of IDS) step(id, { type: 'rematch' });
      }
      step('a', { type: 'leave' });
      expect(s.phase).toBe('finished');
      expect(ledger.reduce((n, l) => n + l.amount, 0)).toBe(0);
      expect(new Set(ledger.map((l) => l.key)).size).toBe(ledger.length);
      expect(conquerEngine.placements(s)).toHaveLength(4);
    }
    expect(rounds).toBe(30);
  });

  it('the double deck has 108 distinct cards', () => {
    expect(new Set(doubleDeckWithJokers()).size).toBe(108);
  });
});
