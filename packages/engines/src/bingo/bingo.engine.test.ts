import { describe, expect, it } from 'vitest';
import { BINGO_FREE, BINGO_LINES, bingoToGo, bingoWinningLine, type BingoCard } from '@akukulu/shared';
import { seededRng, type EngineContext, type EngineResult, type LedgerIntent } from '../core';
import { bingoEngine, dealBingoCard, type BingoState } from './bingo.engine';

const NOW = 1_000_000;
const ctx = (now = NOW, seed = 3, balances?: Record<string, number>): EngineContext => ({
  rng: seededRng(seed),
  now,
  balances: balances ?? Object.fromEntries('abcdefghij'.split('').map((id) => [id, 1000])),
});
const seats = (n: number) => 'abcdefghij'.slice(0, n).split('').map((playerId, seat) => ({ playerId, seat }));

function must(res: EngineResult<BingoState> | null) {
  if (!res) throw new Error('expected a result');
  if (!res.ok) throw new Error(`${res.code}: ${res.error}`);
  return res;
}

const start = (n = 3, stake = 100, seed = 3) => must(bingoEngine.start(seats(n), bingoEngine.parseConfig({}, stake), ctx(NOW, seed))).state;

/** Calls balls until the game ends. */
function run(state: BingoState) {
  let s = state;
  const ledger: LedgerIntent[] = [];
  let calls = 0;
  while (s.phase !== 'finished') {
    const r = must(bingoEngine.tick(s, ctx(s.nextCallAt!)));
    s = r.state;
    ledger.push(...r.ledger);
    if (++calls > 75) throw new Error('game did not end');
  }
  return { state: s, ledger, calls };
}

/** A card whose top row is the given five numbers; the rest never match balls 1–75 used in tests. */
const cardWithTopRow = (row: number[]): BingoCard => [...row, ...Array.from({ length: 20 }, (_, i) => (i === 7 ? BINGO_FREE : 900 + i))];

describe('Bingo cards', () => {
  it('deals 24 different numbers in the right columns around a free middle', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const card = dealBingoCard(seededRng(seed));
      expect(card).toHaveLength(25);
      expect(card[12]).toBe(BINGO_FREE);
      const numbers = card.filter((n) => n !== BINGO_FREE);
      expect(new Set(numbers).size).toBe(24);
      card.forEach((n, i) => {
        if (i === 12) return;
        const col = i % 5;
        expect(n).toBeGreaterThanOrEqual(col * 15 + 1);
        expect(n).toBeLessThanOrEqual(col * 15 + 15);
      });
    }
  });

  it('knows every winning line: 5 rows, 5 columns, 2 diagonals and the corners', () => {
    const card = dealBingoCard(seededRng(9));
    expect(BINGO_LINES).toHaveLength(13);
    for (const line of BINGO_LINES) {
      const called = new Set(line.map((i) => card[i]).filter((n) => n !== BINGO_FREE));
      expect(bingoWinningLine(card, called)).toEqual(line);
      expect(bingoToGo(card, called)).toBe(0);
      // One number short is not a win.
      const short = new Set([...called].slice(1));
      expect(bingoWinningLine(card, short)).toBeNull();
      expect(bingoToGo(card, short)).toBe(1);
    }
    expect(bingoWinningLine(card, new Set())).toBeNull();
    expect(bingoToGo(card, new Set())).toBe(4);
  });
});

describe('Bingo', () => {
  it('takes every stake and needs 2 to 10 players who can pay', () => {
    const res = must(bingoEngine.start(seats(3), bingoEngine.parseConfig({}, 100), ctx()));
    expect(res.ledger.map((l) => [l.playerId, l.amount, l.type])).toEqual([
      ['a', -100, 'stake'],
      ['b', -100, 'stake'],
      ['c', -100, 'stake'],
    ]);
    expect(res.state.pot).toBe(300);
    expect(bingoEngine.start(seats(1), bingoEngine.parseConfig({}, 0), ctx()).ok).toBe(false);
    expect(bingoEngine.start([...seats(10), { playerId: 'k', seat: 10 }], bingoEngine.parseConfig({}, 0), ctx()).ok).toBe(false);
    expect(bingoEngine.start(seats(2), bingoEngine.parseConfig({}, 100), ctx(NOW, 3, { a: 99, b: 1000 })).ok).toBe(false);
    expect(bingoEngine.playerLimits(bingoEngine.parseConfig({}, 0))).toEqual({ min: 2, max: 10 });
  });

  it('gives everyone a different card and uses all 75 balls once', () => {
    const s = start(10);
    expect(new Set(s.players.map((p) => p.card.join())).size).toBe(10);
    expect([...s.balls].sort((x, y) => x - y)).toEqual(Array.from({ length: 75 }, (_, i) => i + 1));
  });

  it('waits, then calls a ball every few seconds', () => {
    let s = start();
    expect(s.phase).toBe('ready');
    expect(s.nextCallAt).toBe(NOW + s.config.readySeconds * 1000);
    expect(bingoEngine.tick(s, ctx(s.nextCallAt! - 1))).toBeNull();
    const at = s.nextCallAt!;
    s = must(bingoEngine.tick(s, ctx(at))).state;
    expect(s.phase).toBe('calling');
    expect(s.calledCount).toBe(1);
    expect(s.nextCallAt).toBe(at + s.config.callSeconds * 1000);
    expect(bingoEngine.view(s, 'a').called).toEqual([s.balls[0]]);
  });

  it('lets a player change card up to three times, only before the first ball', () => {
    let s = start();
    const first = s.players[0].card.join();
    for (let i = 0; i < 3; i++) {
      expect(bingoEngine.view(s, 'a').swapsLeft).toBe(3 - i);
      s = must(bingoEngine.act(s, 'a', { type: 'swap' }, ctx(NOW, 20 + i))).state;
    }
    expect(s.players[0].card.join()).not.toBe(first);
    expect(s.players[0].card[12]).toBe(BINGO_FREE);
    expect(bingoEngine.view(s, 'a').swapsLeft).toBe(0);
    expect(bingoEngine.act(s, 'a', { type: 'swap' }, ctx()).ok).toBe(false);
    s = must(bingoEngine.tick(s, ctx(s.nextCallAt!))).state;
    expect(bingoEngine.act(s, 'b', { type: 'swap' }, ctx()).ok).toBe(false);
    expect(bingoEngine.view(s, 'b').swapsLeft).toBe(0);
  });

  it('pays the whole pot to the first card with a line', () => {
    const s = start(3);
    s.players[1].card = cardWithTopRow(s.balls.slice(0, 5));
    const { state, ledger, calls } = run(s);
    expect(calls).toBe(5);
    expect(state.finishReason).toBe('bingo');
    expect(state.winners).toEqual([{ playerId: 'b', card: state.players[1].card, line: [0, 1, 2, 3, 4], share: 300 }]);
    expect(ledger).toEqual([expect.objectContaining({ playerId: 'b', amount: 300, type: 'payout' })]);
    expect(bingoEngine.placements(state)).toEqual([
      { playerId: 'b', placement: 1, outcome: 'win' },
      { playerId: 'a', placement: 2, outcome: 'loss' },
      { playerId: 'c', placement: 2, outcome: 'loss' },
    ]);
    expect(bingoEngine.tick(state, ctx(NOW * 2))).toBeNull();
    expect(bingoEngine.act(state, 'a', { type: 'leave' }, ctx()).ok).toBe(false);
  });

  it('shares the pot between players who finish on the same ball, down to the last birr', () => {
    const s = start(3, 100);
    s.pot = 301;
    const row = s.balls.slice(0, 5);
    s.players[0].card = cardWithTopRow(row);
    s.players[2].card = cardWithTopRow([...row].reverse());
    const { state, ledger } = run(s);
    expect(state.winners.map((w) => [w.playerId, w.share])).toEqual([
      ['a', 151],
      ['c', 150],
    ]);
    expect(ledger.reduce((sum, l) => sum + l.amount, 0)).toBe(301);
    expect(bingoEngine.placements(state)!.filter((p) => p.outcome === 'win').map((p) => p.playerId)).toEqual(['a', 'c']);
  });

  it('always ends with the pot paid out in full, whatever the cards', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const players = 2 + (seed % 9);
      const { state, ledger, calls } = run(start(players, 50, seed));
      expect(calls).toBeGreaterThanOrEqual(4);
      expect(state.winners.length).toBeGreaterThan(0);
      expect(ledger.every((l) => l.type === 'payout' && l.amount > 0)).toBe(true);
      expect(ledger.reduce((sum, l) => sum + l.amount, 0)).toBe(players * 50);
      const called = new Set(state.balls.slice(0, state.calledCount));
      for (const w of state.winners) expect(w.line.every((i) => w.card[i] === BINGO_FREE || called.has(w.card[i]))).toBe(true);
    }
  });

  it('pays nothing at a free table', () => {
    const { state, ledger } = run(start(4, 0));
    expect(state.winners.length).toBeGreaterThan(0);
    expect(ledger).toEqual([]);
  });

  it('keeps a leaver’s stake in the pot, and the last player left wins it', () => {
    let s = start(3);
    let r = must(bingoEngine.act(s, 'a', { type: 'leave' }, ctx()));
    s = r.state;
    expect(r.ledger).toEqual([]);
    expect(s.phase).toBe('ready');
    expect(s.players[0].status).toBe('left');
    expect(bingoEngine.act(s, 'a', { type: 'swap' }, ctx()).ok).toBe(false);
    r = must(bingoEngine.act(s, 'c', { type: 'leave' }, ctx()));
    expect(r.state.finishReason).toBe('forfeit');
    expect(r.state.winners.map((w) => [w.playerId, w.share])).toEqual([['b', 300]]);
    expect(r.ledger).toEqual([expect.objectContaining({ playerId: 'b', amount: 300 })]);
  });

  it('cannot be won by a player who has left', () => {
    const s = start(3);
    s.players[0].card = cardWithTopRow(s.balls.slice(0, 5));
    const left = must(bingoEngine.act(s, 'a', { type: 'leave' }, ctx())).state;
    const { state, calls } = run(left);
    expect(calls).toBeGreaterThan(5);
    expect(state.winners.some((w) => w.playerId === 'a')).toBe(false);
  });

  it('shows each player only their own card and never the balls to come', () => {
    let s = start(3);
    s = must(bingoEngine.tick(s, ctx(s.nextCallAt!))).state;
    const mine = bingoEngine.view(s, 'a');
    expect(mine.myCard).toEqual(s.players[0].card);
    expect(mine.pot).toBe(300);
    expect(mine.players.map((p) => p.toGo)).toEqual(s.players.map((p) => bingoToGo(p.card, new Set([s.balls[0]]))));
    expect(bingoEngine.view(s, null).myCard).toBeNull();
    const json = JSON.stringify(mine);
    expect(json).not.toContain('balls');
    expect(json).not.toContain(s.players[1].card.join());
    expect(mine.called).toHaveLength(1);
  });

  it('rejects strangers, unknown actions and bad stakes', () => {
    const s = start();
    expect(bingoEngine.act(s, 'z', { type: 'swap' }, ctx()).ok).toBe(false);
    expect(bingoEngine.act(s, 'a', { type: 'bingo' }, ctx()).ok).toBe(false);
    expect(() => bingoEngine.parseConfig({}, -1)).toThrow();
    expect(bingoEngine.parseConfig({ callSeconds: 0, maxSwaps: 99 }, 10)).toMatchObject({ callSeconds: 4, maxSwaps: 3 });
  });
});
