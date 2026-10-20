import { describe, expect, it } from 'vitest';
import { DEFAULT_CRAZY_CONFIG, DEFAULT_CRAZY_RULES, standardDeck, type CrazyConfig, type CrazyRules } from '@akukulu/shared';
import { seededRng, type EngineContext, type EngineResult, type LedgerIntent } from '../core';
import { crazyCardPoints, crazyEngine, crazyInventory, type CrazyState } from './crazy.engine';

const NOW = 50_000_000;
const IDS = ['a', 'b', 'c', 'd', 'e'];
const ctx = (now = NOW, seed = 7, balance = 10_000): EngineContext => ({ rng: seededRng(seed), now, balances: Object.fromEntries(IDS.map((id) => [id, balance])) });
const h = (s: string) => (s ? s.split(' ') : []);

function complete(state: CrazyState) {
  const all = crazyInventory(state);
  expect(all).toHaveLength(52);
  expect(new Set(all).size).toBe(52);
}

function expectOk(res: EngineResult<CrazyState> | null): { state: CrazyState; ledger: LedgerIntent[] } {
  if (!res) throw new Error('expected a result');
  if (!res.ok) throw new Error(`expected ok, got ${res.code}: ${res.error}`);
  complete(res.state);
  return { state: res.state, ledger: res.ledger };
}

function started(players = 2, config: Partial<CrazyConfig> = {}, seed = 7) {
  return expectOk(crazyEngine.start(IDS.slice(0, players).map((playerId, seat) => ({ playerId, seat })), { ...DEFAULT_CRAZY_CONFIG, ...config }, ctx(NOW, seed)));
}

const act = (s: CrazyState, id: string, action: Record<string, unknown>) => crazyEngine.act(s, id, action, ctx());
const run = (s: CrazyState, id: string, action: Record<string, unknown>) => expectOk(act(s, id, action)).state;

/** A two-player table with chosen hands and top card; every other card goes into the stock (`stockTop` drawn first). */
function rigged(opts: { a: string; b: string; top: string; stockTop?: string; current?: 'a' | 'b'; rules?: Partial<CrazyRules>; stake?: number }): CrazyState {
  const s = started(2, { rules: { ...DEFAULT_CRAZY_RULES, ...opts.rules }, stake: opts.stake ?? 0 }).state;
  const a = h(opts.a);
  const b = h(opts.b);
  const top = h(opts.stockTop ?? '');
  const used = new Set([...a, ...b, opts.top, ...top]);
  s.players[0].hand = a;
  s.players[1].hand = b;
  s.discard = [opts.top];
  s.activeSuit = opts.top[1] as CrazyState['activeSuit'];
  s.stock = [...standardDeck().filter((c) => !used.has(c)), ...[...top].reverse()];
  s.current = opts.current === 'b' ? 1 : 0;
  s.pendingDraw = 0;
  s.drawsThisTurn = 0;
  complete(s);
  return s;
}

describe('Crazy setup', () => {
  it('deals 7 cards each to two players and 5 each to three or more, and turns a starter that is not wild (8 or J)', () => {
    for (const [n, size] of [[2, 7], [3, 5], [5, 5]] as const) {
      for (let seed = 1; seed < 40; seed++) {
        const s = started(n, {}, seed).state;
        expect(s.players.every((p) => p.hand.length === size)).toBe(true);
        expect(s.discard).toHaveLength(1);
        expect(['8', 'J']).not.toContain(s.discard[0][0]);
        expect(s.activeSuit).toBe(s.discard[0][1]);
      }
    }
  });

  it('takes the entry stake from everyone and pays the whole pot to the winner', () => {
    const { ledger } = expectOk(crazyEngine.start([0, 1, 2].map((seat) => ({ playerId: IDS[seat], seat })), { ...DEFAULT_CRAZY_CONFIG, stake: 100 }, ctx()));
    expect(ledger.map((l) => l.amount)).toEqual([-100, -100, -100]);
    let s = rigged({ a: '5h', b: '9c 9d', top: '7h', stake: 100 });
    s.players.push({ playerId: 'c', seat: 2, hand: [], status: 'active', missedTurns: 0 });
    const res = expectOk(act(s, 'a', { type: 'play', card: '5h' }));
    expect(res.state.winnerId).toBe('a');
    expect(res.ledger).toEqual([expect.objectContaining({ playerId: 'a', amount: 300, type: 'payout' })]);
  });

  it('rejects bad configuration and player counts', () => {
    expect(() => crazyEngine.parseConfig({ rules: { maxDraws: 99 } }, 0)).toThrow();
    expect(() => crazyEngine.parseConfig({ rules: { drawTwo: 'yes' } }, 0)).toThrow();
    expect(crazyEngine.start([{ playerId: 'a', seat: 0 }], DEFAULT_CRAZY_CONFIG, ctx())).toMatchObject({ ok: false, code: 'BAD_PLAYER_COUNT' });
  });
});

describe('Crazy play', () => {
  it('allows a card of the same suit or rank, and rejects anything else', () => {
    const s = rigged({ a: '7c 3h Kd 9s', b: '4c 4d', top: '7h' });
    expect(crazyEngine.view(s, 'a').legal.play.sort()).toEqual(['3h', '7c']);
    expect(act(s, 'a', { type: 'play', card: 'Kd' })).toMatchObject({ ok: false, code: 'ILLEGAL_CARD' });
    expect(act(s, 'b', { type: 'play', card: '4c' })).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    const next = run(s, 'a', { type: 'play', card: '7c' });
    expect(next.activeSuit).toBe('c');
    expect(next.current).toBe(1);
  });

  it('an 8 can be played on anything and must name the next suit', () => {
    const s = rigged({ a: '8d Kc 2s', b: '4c 4d', top: '7h' });
    expect(act(s, 'a', { type: 'play', card: '8d' })).toMatchObject({ ok: false, code: 'NAME_A_SUIT' });
    const next = run(s, 'a', { type: 'play', card: '8d', suit: 's' });
    expect(next.activeSuit).toBe('s');
    expect(crazyEngine.view(next, 'b').legal.play).toEqual([]);
    expect(crazyEngine.view(next, 'b').activeSuit).toBe('s');
  });

  it('a 2 makes the next player draw two and lose their turn, and 2s stack', () => {
    let s = rigged({ a: '2h 9c', b: '2c 5d', top: '7h', stockTop: 'Ks Qs Js Ts' });
    s = run(s, 'a', { type: 'play', card: '2h' });
    expect(s.pendingDraw).toBe(2);
    expect(crazyEngine.view(s, 'b').legal).toMatchObject({ play: ['2c'], draw: true, pass: false });
    expect(act(s, 'b', { type: 'play', card: '5d' })).toMatchObject({ ok: false, code: 'ILLEGAL_CARD' });
    s = run(s, 'b', { type: 'play', card: '2c' });
    expect(s.pendingDraw).toBe(4);
    // a has no 2: drawing takes all four and the turn passes.
    s = run(s, 'a', { type: 'draw' });
    expect(s.players[0].hand.sort()).toEqual(['9c', 'Js', 'Ks', 'Qs', 'Ts'].sort());
    expect(s.pendingDraw).toBe(0);
    expect(s.current).toBe(1);
  });

  it('without stacking, a 2 cannot be answered', () => {
    let s = rigged({ a: '2h 9c', b: '2c 5d', top: '7h', rules: { stackDrawTwo: false } });
    s = run(s, 'a', { type: 'play', card: '2h' });
    expect(crazyEngine.view(s, 'b').legal.play).toEqual([]);
  });

  it('a Jack is wild like an 8', () => {
    const s = rigged({ a: 'Jc Kc', b: '4c 4d', top: '7h' });
    expect(crazyEngine.view(s, 'a').legal.play).toEqual(['Jc']);
    expect(act(s, 'a', { type: 'play', card: 'Jc' })).toMatchObject({ ok: false, code: 'NAME_A_SUIT' });
    expect(run(s, 'a', { type: 'play', card: 'Jc', suit: 'd' }).activeSuit).toBe('d');
  });

  it('a 5 skips the next player: with two players you play again', () => {
    let s = rigged({ a: '5h 9h Kc', b: '4c 4d', top: '7h' });
    s = run(s, 'a', { type: 'play', card: '5h' });
    expect(s.current).toBe(0);
    expect(s.lastEvent).toMatchObject({ kind: 'play', card: '5h', skipped: 'b' });
    s = run(s, 'a', { type: 'play', card: '9h' });
    expect(s.current).toBe(1);
  });

  it('a 5 skips one player of three', () => {
    let s = started(3).state;
    s.players[0].hand = ['5h', 'Kc'];
    s.players[1].hand = ['4c', '4d'];
    s.players[2].hand = ['9s', '3d'];
    s.stock = standardDeck().filter((c) => !['5h', 'Kc', '4c', '4d', '9s', '3d', '7h'].includes(c));
    s.discard = ['7h'];
    s.activeSuit = 'h';
    s.current = 0;
    s = run(s, 'a', { type: 'play', card: '5h' });
    expect(s.players[s.current].playerId).toBe('c');
  });

  it('a 7 carries more cards of its suit, dropped together; the last card counts', () => {
    let s = rigged({ a: '7h Kh 3h 2h 9c', b: '4c 4d Qs', top: '7s' });
    // The 7 is played on the 7♠ (same rank) and carries K♥ and 3♥.
    s = run(s, 'a', { type: 'play', card: '7h', carry: ['Kh', '3h'] });
    expect(s.discard.slice(-3)).toEqual(['7h', 'Kh', '3h']);
    expect(s.players[0].hand).toEqual(['2h', '9c']);
    expect(s.activeSuit).toBe('h');
    expect(s.lastEvent).toMatchObject({ card: '3h', cards: ['7h', 'Kh', '3h'] });
    expect(s.current).toBe(1);
  });

  it('a carried 2, 5 or wild at the end of a 7 play takes effect', () => {
    const base = { a: '7h 2h 5h Jh 9c', b: '4c 4d Qs', top: '7s' };
    expect(run(rigged(base), 'a', { type: 'play', card: '7h', carry: ['2h'] }).pendingDraw).toBe(2);
    expect(run(rigged(base), 'a', { type: 'play', card: '7h', carry: ['5h'] }).current).toBe(0);
    expect(act(rigged(base), 'a', { type: 'play', card: '7h', carry: ['Jh'] })).toMatchObject({ ok: false, code: 'NAME_A_SUIT' });
    expect(run(rigged(base), 'a', { type: 'play', card: '7h', carry: ['Jh'], suit: 'c' }).activeSuit).toBe('c');
  });

  it('rejects a bad carry: wrong suit, not a 7, not held, or twice', () => {
    const s = rigged({ a: '7h Kh 9c 9h', b: '4c 4d', top: '7s' });
    expect(act(s, 'a', { type: 'play', card: '7h', carry: ['9c'] })).toMatchObject({ ok: false, code: 'BAD_CARRY' });
    const onHeart = rigged({ a: '9h Kh', b: '4c 4d', top: '7h' });
    expect(act(onHeart, 'a', { type: 'play', card: '9h', carry: ['Kh'] })).toMatchObject({ ok: false, code: 'BAD_CARRY' });
    expect(act(s, 'a', { type: 'play', card: '7h', carry: ['Qh'] })).toMatchObject({ ok: false, code: 'BAD_CARRY' });
    expect(act(s, 'a', { type: 'play', card: '7h', carry: ['Kh', 'Kh'] })).toMatchObject({ ok: false, code: 'BAD_CARRY' });
  });

  it('a 7 can carry the last cards to win', () => {
    const s = run(rigged({ a: '7h Kh 3h', b: '4c 4d', top: '7s' }), 'a', { type: 'play', card: '7h', carry: ['Kh', '3h'] });
    expect(s).toMatchObject({ phase: 'finished', winnerId: 'a', finishReason: 'out' });
  });

  it('lets a player pass after drawing one card', () => {
    let s = rigged({ a: 'Kc 9d', b: '4c 4d', top: '7h', stockTop: '3s' });
    expect(crazyEngine.view(s, 'a').legal.pass).toBe(false);
    s = run(s, 'a', { type: 'draw' });
    expect(crazyEngine.view(s, 'a').legal).toMatchObject({ draw: true, pass: true });
    s = run(s, 'a', { type: 'pass' });
    expect(s.current).toBe(1);
  });

  it('draws up to three cards a turn, then lets the player pass', () => {
    let s = rigged({ a: 'Kc 9d', b: '4c 4d', top: '7h', stockTop: '3s 5s 6c Ah' });
    expect(act(s, 'a', { type: 'pass' })).toMatchObject({ ok: false, code: 'CANNOT_PASS' });
    s = run(s, 'a', { type: 'draw' });
    s = run(s, 'a', { type: 'draw' });
    s = run(s, 'a', { type: 'draw' });
    expect(s.players[0].hand).toEqual(['Kc', '9d', '3s', '5s', '6c']);
    expect(act(s, 'a', { type: 'draw' })).toMatchObject({ ok: false, code: 'NO_DRAW' });
    s = run(s, 'a', { type: 'pass' });
    expect(s.current).toBe(1);
    expect(s.drawsThisTurn).toBe(0);
  });

  it('a drawn card that fits can be played straight away', () => {
    let s = rigged({ a: 'Kc 9d', b: '4c 4d', top: '7h', stockTop: '3h' });
    s = run(s, 'a', { type: 'draw' });
    expect(crazyEngine.view(s, 'a').legal.play).toEqual(['3h']);
    s = run(s, 'a', { type: 'play', card: '3h' });
    expect(s.current).toBe(1);
  });

  it('reshuffles the discards (except the top card) when the stock runs out', () => {
    let s = rigged({ a: 'Kc 9d', b: '4c 4d', top: '7h' });
    const rest = s.stock;
    s.stock = [];
    s.discard = [...rest, '7h'];
    s = run(s, 'a', { type: 'draw' });
    expect(s.discard).toEqual(['7h']);
    expect(s.stock).toHaveLength(rest.length - 1);
  });

  it('ends a blocked game when nobody can play or draw: the lowest hand wins', () => {
    // Nothing left to draw; a and b hold no heart, 7 or 8, so neither can follow 7♥.
    const fits = (c: string) => c[1] === 'h' || c[0] === '7' || c[0] === '8' || c[0] === 'J';
    const others = standardDeck().filter((c) => c !== '7h' && !fits(c));
    let s = rigged({ a: '', b: '', top: '7h' });
    s.players[0].hand = others.slice(0, 5); // low cards
    s.players[1].hand = others.slice(5);
    s.stock = [];
    // The cards that would fit belong to a player who has already left.
    s.players.push({ playerId: 'c', seat: 2, hand: standardDeck().filter((c) => c !== '7h' && fits(c)), status: 'forfeited', missedTurns: 0 });
    expect(crazyEngine.view(s, 'a').legal).toMatchObject({ play: [], draw: false, pass: true });
    s = run(s, 'a', { type: 'pass' });
    expect(s.phase).toBe('play');
    s = run(s, 'b', { type: 'pass' });
    expect(s).toMatchObject({ phase: 'finished', finishReason: 'blocked', winnerId: 'a' });
  });
  it('wins by playing the last card, including an 8', () => {
    const s = rigged({ a: '8c', b: '4c 4d', top: '7h' });
    const end = run(s, 'a', { type: 'play', card: '8c', suit: 'd' });
    expect(end).toMatchObject({ phase: 'finished', winnerId: 'a', finishReason: 'out' });
    expect(crazyEngine.placements(end)).toEqual([
      { playerId: 'a', placement: 1, outcome: 'win' },
      { playerId: 'b', placement: 2, outcome: 'loss' },
    ]);
    expect(crazyEngine.view(end, 'a').players[1]).toMatchObject({ revealedHand: ['4c', '4d'], points: 8 });
  });

  it('scores cards left in hand: wild 8 and J = 50, K Q 10 = 10, Ace = 1', () => {
    expect(['8s', 'Jd', 'Kh', 'Td', 'Ac', '7c'].map((c) => crazyCardPoints(c))).toEqual([50, 50, 10, 10, 1, 7]);
  });
});

describe('Crazy saved games', () => {
  it('a game saved before the 7 / 5 / J rules keeps playing by its old rules', () => {
    const s = rigged({ a: 'Jh 5h 9c', b: '4c 4d', top: '7h' });
    s.config = { ...s.config, rules: { eightsWild: true, drawTwo: true, stackDrawTwo: true, maxDraws: 3, handSizeTwoPlayers: 7, handSizeMorePlayers: 5 } as never };
    const v = crazyEngine.view(s, 'a');
    expect(v.config.rules).toMatchObject({ wildRanks: ['8'], skipRank: null, carryRank: null });
    // J is not wild and 5 does not skip in the old game.
    const next = run(s, 'a', { type: 'play', card: '5h' });
    expect(next.current).toBe(1);
    expect(act(s, 'a', { type: 'play', card: 'Jh' }).ok).toBe(true);
  });
});

describe('Crazy timeouts, leaving and privacy', () => {
  it('a timed-out turn is played automatically, and too many timeouts forfeit the game', () => {
    let s = rigged({ a: 'Kc 7d 8s', b: '4c 4d', top: '7h', stake: 0 });
    s = expectOk(crazyEngine.tick(s, ctx(s.turnDeadline!))).state;
    // The 8 is kept: the 7 (same rank) is shed first.
    expect(s.discard[s.discard.length - 1]).toBe('7d');
    expect(s.players[0].missedTurns).toBe(1);
    s.current = 0;
    s.players[0].missedTurns = 2;
    s = expectOk(crazyEngine.tick(s, ctx(s.turnDeadline!))).state;
    expect(s).toMatchObject({ phase: 'finished', winnerId: 'b', finishReason: 'forfeit' });
  });

  it('leaving forfeits; with three players the game goes on', () => {
    let s = started(3).state;
    const leaver = s.players[s.current].playerId;
    s = run(s, leaver, { type: 'leave' });
    expect(s.phase).toBe('play');
    expect(s.players.find((p) => p.playerId === leaver)!.hand).toEqual([]);
    expect(s.players[s.current].playerId).not.toBe(leaver);
  });

  it('shows only your own hand', () => {
    const s = started(3).state;
    const v = crazyEngine.view(s, 'a');
    expect(v.hand).toEqual(s.players[0].hand);
    const json = JSON.stringify(v);
    for (const card of s.players[1].hand) expect(json).not.toContain(`"${card}"`);
    expect(v.players.every((p) => p.revealedHand === null)).toBe(true);
    expect(crazyEngine.view(s, null).hand).toEqual([]);
  });
});

describe('Crazy simulated games', () => {
  it('plays hundreds of random games to the end without losing a card', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const n = 2 + (seed % 4);
      let s = started(n, { rules: { ...DEFAULT_CRAZY_RULES, maxDraws: seed % 5 === 0 ? 0 : 3 } }, seed).state;
      const rng = seededRng(seed * 31);
      for (let step = 0; step < 2000 && s.phase !== 'finished'; step++) {
        const id = s.players[s.current].playerId;
        const v = crazyEngine.view(s, id);
        let action: Record<string, unknown>;
        if (rng.int(40) === 0) action = { type: 'leave' };
        else if (v.legal.play.length > 0 && rng.int(4) > 0) {
          const card = v.legal.play[rng.int(v.legal.play.length)];
          const carry = card[0] === '7' ? v.hand.filter((c) => c !== card && c[1] === card[1] && rng.int(2) === 0) : [];
          action = { type: 'play', card, suit: ['s', 'h', 'd', 'c'][rng.int(4)], ...(carry.length ? { carry } : {}) };
        } else if (v.legal.draw) action = { type: 'draw' };
        else if (v.legal.pass) action = { type: 'pass' };
        else action = { type: 'play', card: v.legal.play[0], suit: 'h' };
        const res = crazyEngine.act(s, id, action, ctx(NOW + step, seed + step));
        if (!res.ok) throw new Error(`seed ${seed} step ${step}: ${res.code} ${res.error} ${JSON.stringify(action)}`);
        s = res.state;
        complete(s);
      }
      expect(s.phase).toBe('finished');
      expect(crazyEngine.placements(s)).toHaveLength(n);
    }
  });
});
