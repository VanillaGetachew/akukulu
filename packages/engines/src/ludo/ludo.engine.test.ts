import { describe, expect, it } from 'vitest';
import { DEFAULT_LUDO_CONFIG, LUDO } from '@akukulu/shared';
import { scriptedRng, seededRng, type EngineContext, type EngineResult } from '../core';
import { legalLudoTokens, ludoEngine, type LudoState } from './ludo.engine';

const NOW = 1_000_000;
/** scriptedRng values are 0-based: die = value + 1. */
const dice = (...rolls: number[]) => scriptedRng(rolls.map((r) => r - 1));
const ctx = (rng = dice(), now = NOW, balances: Record<string, number> = {}): EngineContext => ({ rng, now, balances });

function expectOk<S>(res: EngineResult<S>): S & object {
  if (!res.ok) throw new Error(`expected ok, got ${res.code}: ${res.error}`);
  return res.state as S & object;
}

function twoPlayer(tokens: { a?: number[]; b?: number[] } = {}, current = 0): LudoState {
  const state = expectOk(
    ludoEngine.start(
      [
        { playerId: 'a', seat: 0 },
        { playerId: 'b', seat: 1 },
      ],
      { ...DEFAULT_LUDO_CONFIG },
      ctx(scriptedRng([current])),
    ),
  );
  if (tokens.a) state.players[0].tokens = tokens.a;
  if (tokens.b) state.players[1].tokens = tokens.b;
  return state;
}

describe('Ludo start', () => {
  it('seats two players on opposite colours with every token in the yard', () => {
    const s = twoPlayer();
    expect(s.players.map((p) => p.color)).toEqual(['red', 'yellow']);
    expect(s.players.every((p) => p.tokens.every((t) => t === LUDO.YARD))).toBe(true);
    expect(s.phase).toBe('roll');
    expect(s.turnDeadline).toBe(NOW + DEFAULT_LUDO_CONFIG.turnSeconds * 1000);
  });

  it('assigns four colours for four players and rejects bad player counts', () => {
    const four = expectOk(
      ludoEngine.start([0, 1, 2, 3].map((i) => ({ playerId: `p${i}`, seat: i })), DEFAULT_LUDO_CONFIG, ctx(scriptedRng([0]))),
    );
    expect(four.players.map((p) => p.color)).toEqual(['red', 'green', 'yellow', 'blue']);
    expect(ludoEngine.start([{ playerId: 'solo', seat: 0 }], DEFAULT_LUDO_CONFIG, ctx()).ok).toBe(false);
  });

  it('debits the entry stake and rejects players who cannot afford it', () => {
    const players = [
      { playerId: 'a', seat: 0 },
      { playerId: 'b', seat: 1 },
    ];
    const config = { ...DEFAULT_LUDO_CONFIG, stake: 50 };
    const res = ludoEngine.start(players, config, ctx(scriptedRng([0]), NOW, { a: 100, b: 50 }));
    expect(res.ok && res.ledger.map((l) => l.amount)).toEqual([-50, -50]);
    const poor = ludoEngine.start(players, config, ctx(scriptedRng([0]), NOW, { a: 100, b: 10 }));
    expect(poor.ok).toBe(false);
  });
});

describe('Ludo movement', () => {
  it('requires a six to enter the board', () => {
    const s = expectOk(ludoEngine.act(twoPlayer(), 'a', { type: 'roll' }, ctx(dice(3))));
    expect(s.players[0].tokens).toEqual([-1, -1, -1, -1]);
    expect(s.current).toBe(1);
    expect(s.lastEvent?.kind).toBe('skip');
  });

  it('enters a token on a six and grants another roll', () => {
    const s = expectOk(ludoEngine.act(twoPlayer(), 'a', { type: 'roll' }, ctx(dice(6))));
    expect(s.players[0].tokens[0]).toBe(0);
    expect(s.current).toBe(0);
    expect(s.phase).toBe('roll');
  });

  it('lets the player choose between tokens and moves by the die value', () => {
    let s = twoPlayer({ a: [5, 20, -1, -1] });
    s = expectOk(ludoEngine.act(s, 'a', { type: 'roll' }, ctx(dice(4))));
    expect(s.phase).toBe('move');
    expect(ludoEngine.view(s, 'a').legalTokens).toEqual([0, 1]);
    expect(ludoEngine.view(s, 'b').legalTokens).toEqual([]);
    s = expectOk(ludoEngine.act(s, 'a', { type: 'move', token: 1 }, ctx()));
    expect(s.players[0].tokens).toEqual([5, 24, -1, -1]);
    expect(s.current).toBe(1);
  });

  it('auto-moves when only one token can move', () => {
    const s = expectOk(ludoEngine.act(twoPlayer({ a: [7, -1, -1, -1] }), 'a', { type: 'roll' }, ctx(dice(2))));
    expect(s.players[0].tokens[0]).toBe(9);
    expect(s.current).toBe(1);
  });

  it('captures an opponent on a normal square and grants an extra turn', () => {
    // Red progress 10 = absolute 10. Yellow (offset 26) progress 36 = absolute 10.
    let s = twoPlayer({ a: [6, -1, -1, -1], b: [36, -1, -1, -1] });
    s = expectOk(ludoEngine.act(s, 'a', { type: 'roll' }, ctx(dice(4))));
    expect(s.players[0].tokens[0]).toBe(10);
    expect(s.players[1].tokens[0]).toBe(LUDO.YARD);
    expect(s.lastEvent?.captured).toEqual([{ playerId: 'b', token: 0 }]);
    expect(s.current).toBe(0);
    expect(s.phase).toBe('roll');
  });

  it('never captures on a safe square', () => {
    // Absolute 8 is a star square. Yellow progress 34 = absolute 8.
    let s = twoPlayer({ a: [4, -1, -1, -1], b: [34, -1, -1, -1] });
    s = expectOk(ludoEngine.act(s, 'a', { type: 'roll' }, ctx(dice(4))));
    expect(s.players[0].tokens[0]).toBe(8);
    expect(s.players[1].tokens[0]).toBe(34);
    expect(s.current).toBe(1);
  });

  it('does not capture on an opponent start square', () => {
    // Absolute 26 is yellow's start square; red progress 26 lands there.
    let s = twoPlayer({ a: [22, -1, -1, -1], b: [0, -1, -1, -1] });
    s = expectOk(ludoEngine.act(s, 'a', { type: 'roll' }, ctx(dice(4))));
    expect(s.players[0].tokens[0]).toBe(26);
    expect(s.players[1].tokens[0]).toBe(0);
  });

  it('cannot capture tokens inside a home column', () => {
    let s = twoPlayer({ a: [48, -1, -1, -1], b: [52, -1, -1, -1] });
    s = expectOk(ludoEngine.act(s, 'a', { type: 'roll' }, ctx(dice(4))));
    expect(s.players[0].tokens[0]).toBe(52);
    expect(s.players[1].tokens[0]).toBe(52);
  });

  it('enters the home column after progress 50 and requires an exact finish', () => {
    const player = twoPlayer().players[0];
    player.tokens = [53, -1, -1, -1];
    expect(legalLudoTokens(player, 4)).toEqual([]);
    expect(legalLudoTokens(player, 3)).toEqual([0]);
    let s = twoPlayer({ a: [53, 56, 56, -1] });
    s = expectOk(ludoEngine.act(s, 'a', { type: 'roll' }, ctx(dice(5))));
    expect(s.players[0].tokens[0]).toBe(53); // overshoot: no move
    expect(s.current).toBe(1);
  });

  it('grants an extra turn for reaching home', () => {
    const s = expectOk(ludoEngine.act(twoPlayer({ a: [53, 10, -1, -1] }), 'a', { type: 'roll' }, ctx(dice(3))));
    // Two tokens can move; pick the finishing one.
    const moved = expectOk(ludoEngine.act(s, 'a', { type: 'move', token: 0 }, ctx()));
    expect(moved.players[0].tokens[0]).toBe(LUDO.HOME);
    expect(moved.current).toBe(0);
  });

  it('forfeits the turn on three consecutive sixes', () => {
    let s = twoPlayer({ a: [10, 20, -1, -1] });
    for (let i = 0; i < 2; i++) {
      s = expectOk(ludoEngine.act(s, 'a', { type: 'roll' }, ctx(dice(6))));
      s = expectOk(ludoEngine.act(s, 'a', { type: 'move', token: 0 }, ctx()));
      expect(s.current).toBe(0);
    }
    s = expectOk(ludoEngine.act(s, 'a', { type: 'roll' }, ctx(dice(6))));
    expect(s.players[0].tokens[0]).toBe(22);
    expect(s.current).toBe(1);
    expect(s.consecutiveSixes).toBe(0);
  });

  it('rolls again on a six with no legal move', () => {
    const s = expectOk(ludoEngine.act(twoPlayer({ a: [55, 56, 56, 56] }), 'a', { type: 'roll' }, ctx(dice(6))));
    expect(s.current).toBe(0);
    expect(s.phase).toBe('roll');
  });
});

describe('Ludo victory', () => {
  it('declares the winner when all four tokens are home and pays the pot once', () => {
    let s = twoPlayer({ a: [56, 56, 56, 54] });
    s.config.stake = 25;
    const res = ludoEngine.act(s, 'a', { type: 'roll' }, ctx(dice(2)));
    s = expectOk(res);
    expect(s.phase).toBe('finished');
    expect(s.winnerId).toBe('a');
    expect(res.ok && res.ledger).toEqual([expect.objectContaining({ playerId: 'a', amount: 50, key: 'payout:a' })]);
    expect(ludoEngine.isFinished(s)).toBe(true);
    expect(ludoEngine.placements(s)).toEqual([
      { playerId: 'a', placement: 1, outcome: 'win' },
      { playerId: 'b', placement: 2, outcome: 'loss' },
    ]);
    expect(ludoEngine.act(s, 'b', { type: 'roll' }, ctx(dice(1))).ok).toBe(false);
    expect(ludoEngine.tick(s, ctx(dice(), NOW * 10))).toBeNull();
  });

  it('awards the match to the last remaining player when the opponent leaves', () => {
    const s = expectOk(ludoEngine.act(twoPlayer(), 'b', { type: 'leave' }, ctx()));
    expect(s.winnerId).toBe('a');
    expect(ludoEngine.placements(s)?.[1]).toEqual({ playerId: 'b', placement: 2, outcome: 'loss' });
  });
});

describe('Ludo invalid actions', () => {
  it('rejects out-of-turn, out-of-phase and malformed actions', () => {
    const s = twoPlayer({ a: [5, 20, -1, -1] });
    expect(ludoEngine.act(s, 'b', { type: 'roll' }, ctx(dice(1)))).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(ludoEngine.act(s, 'a', { type: 'move', token: 0 }, ctx())).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
    expect(ludoEngine.act(s, 'zz', { type: 'roll' }, ctx())).toMatchObject({ ok: false, code: 'NOT_IN_MATCH' });
    expect(ludoEngine.act(s, 'a', { type: 'cheat' }, ctx())).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' });
    const rolled = expectOk(ludoEngine.act(s, 'a', { type: 'roll' }, ctx(dice(3))));
    expect(ludoEngine.act(rolled, 'a', { type: 'roll' }, ctx(dice(1)))).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
    expect(ludoEngine.act(rolled, 'a', { type: 'move', token: 2 }, ctx())).toMatchObject({ ok: false, code: 'ILLEGAL_MOVE' });
    expect(ludoEngine.act(rolled, 'a', { type: 'move', token: 9 }, ctx())).toMatchObject({ ok: false, code: 'BAD_TOKEN' });
  });

  it('ignores any client-supplied dice value', () => {
    const s = expectOk(ludoEngine.act(twoPlayer(), 'a', { type: 'roll', die: 6, value: 6 }, ctx(dice(2))));
    expect(s.players[0].tokens).toEqual([-1, -1, -1, -1]);
    expect(s.lastEvent?.die).toBe(2);
  });

  it('does not mutate the previous state', () => {
    const s = twoPlayer({ a: [6, -1, -1, -1] });
    const snapshot = JSON.stringify(s);
    ludoEngine.act(s, 'a', { type: 'roll' }, ctx(dice(4)));
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe('Ludo turn transitions and timeouts', () => {
  it('skips forfeited players in turn order', () => {
    let s = expectOk(
      ludoEngine.start([0, 1, 2].map((i) => ({ playerId: `p${i}`, seat: i })), DEFAULT_LUDO_CONFIG, ctx(scriptedRng([0]))),
    );
    s = expectOk(ludoEngine.act(s, 'p1', { type: 'leave' }, ctx()));
    s = expectOk(ludoEngine.act(s, 'p0', { type: 'roll' }, ctx(dice(2))));
    expect(s.players[s.current].playerId).toBe('p2');
    s = expectOk(ludoEngine.act(s, 'p2', { type: 'roll' }, ctx(dice(2))));
    expect(s.players[s.current].playerId).toBe('p0');
  });

  it('does nothing before the deadline and auto-plays after it', () => {
    const s = twoPlayer({ a: [10, -1, -1, -1] });
    expect(ludoEngine.tick(s, ctx(dice(), NOW + 1000))).toBeNull();
    const after = ludoEngine.tick(s, ctx(dice(3), s.turnDeadline!));
    const next = expectOk(after!);
    expect(next.players[0].tokens[0]).toBe(13);
    expect(next.players[0].missedTurns).toBe(1);
    expect(next.current).toBe(1);
  });

  it('forfeits a player after the configured number of missed turns', () => {
    let s = twoPlayer();
    s.players[0].missedTurns = DEFAULT_LUDO_CONFIG.maxMissedTurns - 1;
    s = expectOk(ludoEngine.tick(s, ctx(dice(), s.turnDeadline!))!);
    expect(s.players[0].status).toBe('forfeited');
    expect(s.winnerId).toBe('b');
  });

  it('resets missed turns when the player acts', () => {
    let s = twoPlayer();
    s.players[0].missedTurns = 2;
    s = expectOk(ludoEngine.act(s, 'a', { type: 'roll' }, ctx(dice(1))));
    expect(s.players[0].missedTurns).toBe(0);
  });
});

describe('Ludo simulated matches', () => {
  for (const count of [2, 3, 4]) {
    it(`plays complete ${count}-player matches to a single winner`, () => {
      for (let seed = 1; seed <= 15; seed++) {
        const rng = seededRng(seed * 31 + count);
        const players = Array.from({ length: count }, (_, i) => ({ playerId: `p${i}`, seat: i }));
        let s = expectOk(ludoEngine.start(players, { ...DEFAULT_LUDO_CONFIG, autoMoveSingle: false }, ctx(rng)));
        let steps = 0;
        while (!ludoEngine.isFinished(s)) {
          if (++steps > 20_000) throw new Error('match did not terminate');
          const current = s.players[s.current].playerId;
          if (s.phase === 'roll') {
            s = expectOk(ludoEngine.act(s, current, { type: 'roll' }, ctx(rng)));
          } else {
            const legal = ludoEngine.view(s, current).legalTokens;
            const token = legal[rng.int(legal.length)];
            s = expectOk(ludoEngine.act(s, current, { type: 'move', token }, ctx(rng)));
          }
          for (const p of s.players) for (const t of p.tokens) expect(t >= LUDO.YARD && t <= LUDO.HOME).toBe(true);
        }
        const winner = s.players.find((p) => p.playerId === s.winnerId)!;
        expect(winner.tokens.every((t) => t === LUDO.HOME)).toBe(true);
        expect(ludoEngine.placements(s)).toHaveLength(count);
      }
    });
  }
});
