import { describe, expect, it } from 'vitest';
import { DEFAULT_BLACKJACK_CONFIG, HIDDEN_CARD, type BlackjackConfig } from '@akukulu/shared';
import { seededRng, type EngineContext, type EngineResult, type LedgerIntent } from '../core';
import { blackjackEngine, handTotal, isNatural, type BlackjackState } from './blackjack.engine';

const NOW = 5_000_000;
const ctx = (balance = 1000, now = NOW): EngineContext => ({ rng: seededRng(7), now, balances: { p: balance } });

function expectOk(res: EngineResult<BlackjackState> | null): { state: BlackjackState; ledger: LedgerIntent[] } {
  if (!res) throw new Error('expected a result');
  if (!res.ok) throw new Error(`expected ok, got ${res.code}: ${res.error}`);
  return { state: res.state, ledger: res.ledger };
}

/**
 * Creates a table whose shoe deals `cards` in the given order.
 * Initial deal order: player, dealer up, player, dealer hole.
 */
function table(cards: string[], config: Partial<BlackjackConfig> = {}): BlackjackState {
  const { state } = expectOk(blackjackEngine.start([{ playerId: 'p', seat: 0 }], { ...DEFAULT_BLACKJACK_CONFIG, ...config }, ctx()));
  state.shoe = [...cards].reverse();
  state.shoeSize = state.shoe.length; // keep penetration from triggering a reshuffle
  return state;
}

const bet = (s: BlackjackState, amount = 10, balance = 1000) => expectOk(blackjackEngine.act(s, 'p', { type: 'bet', amount }, ctx(balance)));
const act = (s: BlackjackState, type: string, balance = 1000) => expectOk(blackjackEngine.act(s, 'p', { type }, ctx(balance)));

describe('Blackjack hand values', () => {
  it('counts aces as 11 or 1 and reports soft totals', () => {
    expect(handTotal(['Ah', '6d'])).toEqual({ total: 17, soft: true });
    expect(handTotal(['Ah', '6d', 'Tc'])).toEqual({ total: 17, soft: false });
    expect(handTotal(['Ah', 'Ad', '9c'])).toEqual({ total: 21, soft: true });
    expect(handTotal(['Kh', 'Qd', '2c'])).toEqual({ total: 22, soft: false });
    expect(isNatural(['Ah', 'Kd'])).toBe(true);
    expect(isNatural(['Ah', 'Kd'], true)).toBe(false);
    expect(isNatural(['7h', '7d', '7c'])).toBe(false);
  });
});

describe('Blackjack round resolution', () => {
  it('pays a natural blackjack 3:2 immediately', () => {
    const { state, ledger } = bet(table(['Ah', '9c', 'Kd', '7s']), 10);
    expect(state.phase).toBe('roundOver');
    expect(state.hands[0].result).toBe('blackjack');
    expect(ledger.map((l) => l.amount)).toEqual([-10, 25]);
    expect(state.lastRoundNet).toBe(15);
  });

  it('pays 6:5 when configured, rounding down', () => {
    const { ledger } = bet(table(['Ah', '9c', 'Kd', '7s'], { blackjackPayout: 1.2 }), 15);
    expect(ledger.map((l) => l.amount)).toEqual([-15, 33]);
  });

  it('loses to a dealer natural after the peek', () => {
    const { state, ledger } = bet(table(['9h', 'Ac', '7d', 'Ks']));
    expect(state.phase).toBe('roundOver');
    expect(state.dealerRevealed).toBe(true);
    expect(state.hands[0].result).toBe('lose');
    expect(ledger.map((l) => l.amount)).toEqual([-10]);
  });

  it('pushes when both player and dealer have naturals', () => {
    const { state, ledger } = bet(table(['Ah', 'Kc', 'Qd', 'As']));
    expect(state.hands[0].result).toBe('push');
    expect(ledger.map((l) => l.amount)).toEqual([-10, 10]);
  });

  it('busts on a hit over 21 and the dealer does not draw', () => {
    let { state } = bet(table(['Th', '9c', '6d', '7s', 'Kc', '5h']));
    ({ state } = act(state, 'hit'));
    expect(state.hands[0].result).toBe('bust');
    expect(state.dealer).toHaveLength(2);
  });

  it('dealer stands on soft 17 under S17', () => {
    let { state } = bet(table(['Th', 'Ac', '8d', '6s', '4h']));
    const r = act(state, 'stand');
    state = r.state;
    expect(state.dealer).toEqual(['Ac', '6s']);
    expect(state.hands[0].result).toBe('win');
    expect(r.ledger.map((l) => l.amount)).toEqual([20]);
  });

  it('dealer hits soft 17 under H17', () => {
    let { state } = bet(table(['Th', 'Ac', '8d', '6s', '4h'], { dealerHitsSoft17: true }));
    ({ state } = act(state, 'stand'));
    expect(state.dealer).toEqual(['Ac', '6s', '4h']);
    expect(state.hands[0].result).toBe('lose');
  });

  it('dealer draws until reaching 17 and can bust', () => {
    let { state } = bet(table(['Th', 'Tc', '2d', '6s', 'Kh']));
    const r = act(state, 'stand');
    state = r.state;
    expect(handTotal(state.dealer).total).toBe(26);
    expect(state.hands[0].result).toBe('win');
  });

  it('pushes on equal totals', () => {
    let { state } = bet(table(['Th', 'Tc', '7d', '7s']));
    const r = act(state, 'stand');
    expect(r.state.hands[0].result).toBe('push');
    expect(r.ledger.map((l) => l.amount)).toEqual([10]);
  });

  it('auto-stands a hand that reaches 21', () => {
    let { state } = bet(table(['5h', 'Tc', '6d', '7s', 'Th']));
    ({ state } = act(state, 'hit'));
    expect(state.phase).toBe('roundOver');
    expect(state.hands[0].result).toBe('win');
  });
});

describe('Blackjack double and split', () => {
  it('doubles: debits the extra stake, takes one card and stands', () => {
    const { state: dealt } = bet(table(['5h', 'Tc', '6d', '7s', 'Th']));
    const r = act(dealt, 'double');
    expect(r.state.hands[0]).toMatchObject({ bet: 20, doubled: true, result: 'win', payout: 40 });
    expect(r.ledger.map((l) => l.amount)).toEqual([-10, 40]);
  });

  it('rejects doubling without balance or outside the configured totals', () => {
    const { state: dealt } = bet(table(['5h', 'Tc', '6d', '7s', 'Th']), 10, 10);
    expect(blackjackEngine.act(dealt, 'p', { type: 'double' }, ctx(5)).ok).toBe(false);
    const { state: nine } = bet(table(['5h', 'Tc', '4d', '7s'], { doubleOn: '10-11' }));
    expect(blackjackEngine.act(nine, 'p', { type: 'double' }, ctx())).toMatchObject({ ok: false, code: 'ILLEGAL_ACTION' });
  });

  it('splits a pair into two independently played hands', () => {
    // Deal 8,8 vs dealer T/7; split draws 3 (hand 1) and K (hand 2); hand 1 hits T.
    let { state } = bet(table(['8h', 'Tc', '8d', '7s', '3c', 'Kh', 'Td']));
    const split = act(state, 'split');
    state = split.state;
    expect(split.ledger.map((l) => l.amount)).toEqual([-10]);
    expect(state.hands.map((h) => h.cards)).toEqual([['8h', '3c'], ['8d', 'Kh']]);
    ({ state } = act(state, 'hit')); // 8+3+T = 21 â†’ auto stand, move to hand 2
    expect(state.activeHand).toBe(1);
    const end = act(state, 'stand');
    expect(end.state.hands.map((h) => h.result)).toEqual(['win', 'win']);
    expect(end.ledger.map((l) => l.amount)).toEqual([40]);
  });

  it('gives split aces one card each and pays 21 as an ordinary win', () => {
    const r = act(bet(table(['Ah', '9c', 'Ad', '8s', 'Kc', '5h'])).state, 'split');
    expect(r.state.hands.every((h) => h.done && h.splitAces)).toBe(true);
    expect(r.state.hands.map((h) => h.result)).toEqual(['win', 'lose']);
    expect(r.state.hands[0].payout).toBe(20);
  });

  it('rejects splitting non-pairs and splitting beyond the hand limit', () => {
    const { state } = bet(table(['8h', 'Tc', '9d', '7s']));
    expect(blackjackEngine.act(state, 'p', { type: 'split' }, ctx()).ok).toBe(false);
    const { state: pair } = bet(table(['8h', 'Tc', '8d', '7s', '8c', '2h'], { maxHands: 1 }));
    expect(blackjackEngine.act(pair, 'p', { type: 'split' }, ctx())).toMatchObject({ ok: false, code: 'ILLEGAL_ACTION' });
  });

  it('allows splitting equal ten-value cards', () => {
    const { state } = bet(table(['Kh', '9c', 'Qd', '7s', '2c', '3h']));
    expect(blackjackEngine.act(state, 'p', { type: 'split' }, ctx()).ok).toBe(true);
  });
});

describe('Blackjack validation and privacy', () => {
  it('validates bets and phases', () => {
    const s = table(['Th', '9c', '6d', '7s']);
    expect(blackjackEngine.act(s, 'p', { type: 'bet', amount: 5 }, ctx())).toMatchObject({ ok: false, code: 'BAD_AMOUNT' });
    expect(blackjackEngine.act(s, 'p', { type: 'bet', amount: 501 }, ctx())).toMatchObject({ ok: false, code: 'BAD_AMOUNT' });
    expect(blackjackEngine.act(s, 'p', { type: 'bet', amount: 10.5 }, ctx())).toMatchObject({ ok: false, code: 'BAD_AMOUNT' });
    expect(blackjackEngine.act(s, 'p', { type: 'bet', amount: 100 }, ctx(50))).toMatchObject({ ok: false, code: 'INSUFFICIENT_BALANCE' });
    expect(blackjackEngine.act(s, 'p', { type: 'hit' }, ctx())).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
    expect(blackjackEngine.act(s, 'intruder', { type: 'bet', amount: 10 }, ctx())).toMatchObject({ ok: false, code: 'NOT_IN_MATCH' });
    const { state } = bet(s);
    expect(blackjackEngine.act(state, 'p', { type: 'bet', amount: 10 }, ctx())).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
  });

  it('hides the dealer hole card and the shoe until revealed', () => {
    const { state } = bet(table(['Th', '9c', '6d', '8s']));
    const view = blackjackEngine.view(state, 'p');
    expect(view.dealer.cards).toEqual(['9c', HIDDEN_CARD]);
    expect(view.dealer.total).toBe(9);
    expect(JSON.stringify(view)).not.toContain('8s');
    expect(view).not.toHaveProperty('shoe');
    const done = act(state, 'stand').state;
    expect(blackjackEngine.view(done, 'p').dealer.cards).toEqual(['9c', '8s']);
  });

  it('auto-stands on turn timeout and closes idle sessions', () => {
    const { state } = bet(table(['Th', '9c', '8d', '7s', 'Kc']));
    expect(blackjackEngine.tick(state, ctx(1000, NOW + 1000))).toBeNull();
    const t = expectOk(blackjackEngine.tick(state, ctx(1000, state.turnDeadline!)));
    expect(t.state.phase).toBe('roundOver');
    const idle = expectOk(blackjackEngine.tick(t.state, ctx(1000, t.state.turnDeadline!)));
    expect(idle.state.phase).toBe('finished');
    expect(blackjackEngine.placements(idle.state)).toEqual([{ playerId: 'p', placement: 1, outcome: 'win' }]);
  });

  it('settles the open round when the player leaves mid-hand', () => {
    const { state } = bet(table(['Th', '9c', '6d', '7s', '2c']));
    const r = expectOk(blackjackEngine.act(state, 'p', { type: 'leave' }, ctx()));
    expect(r.state.phase).toBe('finished');
    expect(r.state.hands[0].result).toBe('lose');
    expect(blackjackEngine.act(r.state, 'p', { type: 'bet', amount: 10 }, ctx()).ok).toBe(false);
  });
});

describe('Blackjack simulated sessions', () => {
  it('keeps ledger, session net and card counts consistent over many rounds', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const rng = seededRng(seed);
      const c = (balance: number): EngineContext => ({ rng, now: NOW, balances: { p: balance } });
      let balance = 2000;
      let res = blackjackEngine.start([{ playerId: 'p', seat: 0 }], { ...DEFAULT_BLACKJACK_CONFIG, decks: 1 }, c(balance));
      if (!res.ok) throw new Error(res.error);
      let s = res.state;
      let ledgerSum = 0;
      const keys = new Set<string>();
      for (let round = 0; round < 60; round++) {
        const step = (action: Record<string, unknown>) => {
          const r = blackjackEngine.act(s, 'p', action, c(balance));
          if (!r.ok) throw new Error(`${r.code}: ${r.error}`);
          for (const l of r.ledger) {
            expect(keys.has(l.key)).toBe(false);
            keys.add(l.key);
            ledgerSum += l.amount;
            balance += l.amount;
            expect(balance).toBeGreaterThanOrEqual(0);
          }
          s = r.state;
        };
        step({ type: 'bet', amount: 10 + rng.int(5) * 10 });
        while (s.phase === 'playerTurn') {
          const legal = blackjackEngine.view(s, 'p').legal;
          const options = (['hit', 'stand', 'double', 'split'] as const).filter((a) => legal[a]);
          const choice = options[rng.int(options.length)];
          const r = blackjackEngine.act(s, 'p', { type: choice }, c(balance));
          // A view may advertise double/split that the live balance cannot afford.
          step(r.ok ? { type: choice } : { type: 'stand' });
        }
        expect(s.phase).toBe('roundOver');
        expect(s.hands.every((h) => h.result !== null)).toBe(true);
      }
      expect(ledgerSum).toBe(s.sessionNet);
      expect(balance).toBe(2000 + s.sessionNet);
    }
  });
});
