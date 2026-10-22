import {
  DEFAULT_POKER_CONFIG,
  POKER_TOURNAMENT_BIG_BLINDS,
  pokerMttLevel,
  pokerMttPayouts,
  type PokerConfig,
  type PokerView,
} from '@akukulu/shared';
import {
  asRecord,
  actionType,
  clone,
  fail,
  intInRange,
  ok,
  shuffle,
  type EngineContext,
  type EngineEvent,
  type EngineResult,
  type GameEngine,
  type LedgerIntent,
  type Placement,
} from '../core';
import { freeSeats, insertSeat, newSeat, pokerEngine, removeSeatAt, type PokerSeatState, type PokerState } from './poker.engine';

/**
 * A scheduled multi-table tournament: one match holding every table. Each table is an
 * ordinary poker table state (mode 'mtt') run by {@link pokerEngine}; this wrapper sets
 * the blinds by the clock, takes out busted players, moves players to keep the tables
 * within one of each other, breaks tables as the field shrinks and pays the prizes.
 */
export interface PokerMttState {
  kind: 'mtt';
  config: PokerConfig;
  tables: PokerState[];
  startedAt: number;
  entrants: number;
  /** Finishing place of everyone who is out (and of the winner at the end). */
  places: Record<string, number>;
  nextTableId: number;
  finished: boolean;
}

interface Out {
  events: EngineEvent[];
  ledger: LedgerIntent[];
}

const DEFAULT_STACK = 3000;
const FIRST_DEAL_MS = 3000;
const RESUME_MS = 2000;

const levelMs = (c: PokerConfig) => (c.levelMinutes ?? 8) * 60_000;
const levelAt = (s: PokerMttState, now: number) => Math.floor(Math.max(0, now - s.startedAt) / levelMs(s.config));
export const mttPrizePool = (s: PokerMttState) => Math.max(s.config.guarantee ?? 0, s.config.buyIn * s.entrants);
const lateRegEndsAt = (s: PokerMttState) => (s.config.lateRegLevels ? s.startedAt + s.config.lateRegLevels * levelMs(s.config) : null);
const alive = (t: PokerState) => t.players.filter((p) => p.status === 'active');
const aliveCount = (s: PokerMttState) => s.tables.reduce((n, t) => n + alive(t).length, 0);
const betweenHands = (t: PokerState) => t.current === null && (t.phase === 'handComplete' || t.phase === 'waiting');
const isBetting = (t: PokerState) => ['preflop', 'flop', 'turn', 'river', 'showdown'].includes(t.phase);
/** A player's chips including what they have in the pot of a hand still being played. */
const chipsOf = (t: PokerState, p: PokerSeatState) => (isBetting(t) ? p.stack + p.totalCommitted : p.stack);

function tableConfig(c: PokerConfig, level: number): PokerConfig {
  return { ...c, ...pokerMttLevel(level) };
}

function newTable(s: PokerMttState, playerIds: string[], ctx: EngineContext): PokerState {
  const config = tableConfig(s.config, levelAt(s, ctx.now));
  const stack = s.config.startingStack ?? DEFAULT_STACK;
  return {
    config,
    players: playerIds.map((id, i) => newSeat(id, i, stack)),
    handNumber: 0,
    button: playerIds.length ? ctx.rng.int(playerIds.length) : 0,
    smallBlindIndex: null,
    bigBlindIndex: null,
    phase: 'waiting',
    deck: [],
    community: [],
    current: null,
    currentBet: 0,
    minRaise: config.bigBlind,
    turnDeadline: null,
    nextHandAt: null,
    lastHand: null,
    exits: 0,
    tableId: s.nextTableId++,
  };
}

function collect(s: PokerMttState, index: number, res: EngineResult<PokerState>, out: Out) {
  if (!res.ok) return;
  const tableId = s.tables[index].tableId;
  s.tables[index] = res.state;
  for (const e of res.events) out.events.push({ ...e, data: { ...(e.data ?? {}), tableId } });
  out.ledger.push(...res.ledger);
}

function movePlayer(s: PokerMttState, from: PokerState, index: number, to: PokerState, out: Out) {
  const p = from.players[index];
  removeSeatAt(from, index);
  insertSeat(to, newSeat(p.playerId, freeSeats(to)[0], p.stack));
  out.events.push({ type: 'moved', playerId: p.playerId, data: { from: from.tableId, to: to.tableId } });
}

/** Whoever would post the big blind next leaves a table that is being balanced. */
function nextBigBlindIndex(t: PokerState): number {
  const n = t.players.length;
  return (t.button + (n > 3 ? 3 : 1)) % n;
}

/** Runs after every transition: clears out busted players, finishes, balances and restarts tables. */
function settle(s: PokerMttState, ctx: EngineContext, out: Out) {
  // 1. Players who are out leave their table between hands; a bigger starting stack places higher.
  const gone: PokerSeatState[] = [];
  for (const t of s.tables) {
    if (!betweenHands(t)) continue;
    for (let k = t.players.length - 1; k >= 0; k--) {
      if (t.players[k].status !== 'active') {
        gone.push(t.players[k]);
        removeSeatAt(t, k);
      }
    }
  }
  gone.sort((a, b) => b.handStartStack - a.handStartStack);
  const stillSeated = s.tables.reduce((n, t) => n + t.players.length, 0);
  gone.forEach((p, k) => {
    if (s.places[p.playerId] === undefined) {
      s.places[p.playerId] = stillSeated + 1 + k;
      out.events.push({ type: 'eliminated', playerId: p.playerId, data: { place: stillSeated + 1 + k } });
    }
  });

  // 2. One player left: the tournament is over.
  if (aliveCount(s) <= 1 && s.tables.every(betweenHands)) {
    finish(s, out);
    return;
  }

  // 3. Break tables as the field shrinks; keep the rest within one player of each other.
  const maxSeats = s.config.maxSeats;
  for (let guard = 0; guard < 500; guard++) {
    const need = Math.max(1, Math.ceil(aliveCount(s) / maxSeats));
    if (s.tables.length > need) {
      const breakable = s.tables.filter(betweenHands).sort((a, b) => a.players.length - b.players.length)[0];
      if (breakable) {
        while (breakable.players.length) {
          const target = s.tables
            .filter((t) => t !== breakable && freeSeats(t).length)
            .sort((a, b) => a.players.length - b.players.length)[0];
          if (!target) break;
          movePlayer(s, breakable, breakable.players.length - 1, target, out);
        }
        if (!breakable.players.length) {
          out.events.push({ type: 'table_closed', data: { tableId: breakable.tableId } });
          s.tables = s.tables.filter((t) => t !== breakable);
          continue;
        }
      }
    }
    const smallest = [...s.tables].sort((a, b) => a.players.length - b.players.length)[0];
    const donor = s.tables
      .filter((t) => t !== smallest && betweenHands(t) && t.players.length - smallest.players.length > 1)
      .sort((a, b) => b.players.length - a.players.length)[0];
    if (!donor) break;
    movePlayer(s, donor, nextBigBlindIndex(donor), smallest, out);
  }

  // 4. Tables with two or more players deal on; the others wait for players to be moved in.
  for (const t of s.tables) {
    if (!betweenHands(t)) continue;
    const ready = t.players.filter((p) => p.status === 'active' && p.stack > 0).length >= 2;
    if (!ready) {
      t.phase = 'waiting';
      t.nextHandAt = null;
    } else if (t.nextHandAt === null) {
      t.phase = 'handComplete';
      t.nextHandAt = ctx.now + RESUME_MS;
    }
  }
}

function finish(s: PokerMttState, out: Out) {
  for (const t of s.tables) for (const p of alive(t)) s.places[p.playerId] = 1;
  const prizes = pokerMttPayouts(mttPrizePool(s), s.entrants);
  for (const [playerId, place] of Object.entries(s.places)) {
    const prize = prizes[place - 1] ?? 0;
    if (prize > 0) {
      out.ledger.push({ playerId, amount: prize, key: `prize:${playerId}`, type: 'payout', description: `${s.config.name ?? 'Tournament'}: ${ordinal(place)} place` });
    }
  }
  for (const t of s.tables) {
    t.current = null;
    t.turnDeadline = null;
    t.nextHandAt = null;
  }
  s.finished = true;
  out.events.push({ type: 'match_finished', data: { places: s.places } });
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function lateRegister(s: PokerMttState, playerId: string, ctx: EngineContext, out: Out): string | null {
  if (s.places[playerId] !== undefined || s.tables.some((t) => t.players.some((p) => p.playerId === playerId))) return 'You are already in this tournament';
  const ends = lateRegEndsAt(s);
  if (ends === null || ctx.now >= ends) return 'Late registration has closed';
  s.entrants += 1;
  let table = [...s.tables].filter((t) => freeSeats(t).length).sort((a, b) => a.players.length - b.players.length)[0];
  if (!table) {
    table = newTable(s, [], ctx);
    s.tables.push(table);
  }
  insertSeat(table, newSeat(playerId, freeSeats(table)[0], s.config.startingStack ?? DEFAULT_STACK));
  out.events.push({ type: 'registered', playerId, data: { tableId: table.tableId } });
  return null;
}

export function parseMttConfig(input: unknown, stake: number): PokerConfig {
  const raw = asRecord(input);
  const c: PokerConfig = { ...DEFAULT_POKER_CONFIG, mode: 'mtt', maxSeats: 9, handPauseMs: 4000 };
  c.buyIn = intInRange(stake, 0, 1_000_000, 'buy-in');
  if (raw.maxSeats !== undefined) c.maxSeats = intInRange(raw.maxSeats, 2, 9, 'maxSeats');
  c.startingStack = raw.startingStack !== undefined ? intInRange(raw.startingStack, 500, 1_000_000, 'startingStack') : DEFAULT_STACK;
  c.levelMinutes = raw.levelMinutes !== undefined ? intInRange(raw.levelMinutes, 1, 60, 'levelMinutes') : 8;
  c.lateRegLevels = raw.lateRegLevels !== undefined ? intInRange(raw.lateRegLevels, 0, 12, 'lateRegLevels') : 3;
  c.guarantee = raw.guarantee !== undefined ? intInRange(raw.guarantee, 0, 100_000_000, 'guarantee') : 0;
  c.name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : 'Tournament';
  if (typeof raw.tournamentId === 'string') c.tournamentId = raw.tournamentId.slice(0, 64);
  if (raw.turnSeconds !== undefined) c.turnSeconds = intInRange(raw.turnSeconds, 10, 120, 'turnSeconds');
  Object.assign(c, pokerMttLevel(0));
  return c;
}

export const pokerMttEngine: GameEngine<PokerMttState, PokerConfig, PokerView> = {
  slug: 'poker',
  parseConfig: parseMttConfig,
  playerLimits: () => ({ min: 2, max: 10_000 }),

  start(players, config, ctx) {
    if (players.length < 2) return fail('BAD_PLAYER_COUNT', 'A tournament needs at least 2 players');
    const s: PokerMttState = { kind: 'mtt', config, tables: [], startedAt: ctx.now, entrants: players.length, places: {}, nextTableId: 1, finished: false };
    const ids = shuffle(players.map((p) => p.playerId), ctx.rng);
    const count = Math.ceil(ids.length / config.maxSeats);
    const groups: string[][] = Array.from({ length: count }, () => []);
    ids.forEach((id, i) => groups[i % count].push(id));
    for (const g of groups) {
      const t = newTable(s, g, ctx);
      t.phase = 'handComplete';
      t.nextHandAt = ctx.now + FIRST_DEAL_MS;
      s.tables.push(t);
    }
    return ok(s, [{ type: 'tournament_started', data: { entrants: ids.length, tables: count } }]);
  },

  act(prev, playerId, action, ctx) {
    if (prev.finished) return fail('GAME_OVER', 'The tournament is over');
    const s = clone(prev);
    const out: Out = { events: [], ledger: [] };
    if (actionType(action) === 'register') {
      const error = lateRegister(s, playerId, ctx, out);
      if (error) return fail('CANNOT_REGISTER', error);
      settle(s, ctx, out);
      return ok(s, out.events, out.ledger);
    }
    const index = s.tables.findIndex((t) => t.players.some((p) => p.playerId === playerId && p.status === 'active'));
    if (index < 0) return fail(s.places[playerId] !== undefined ? 'NOT_ACTIVE' : 'NOT_IN_MATCH', 'You are no longer in this tournament');
    const res = pokerEngine.act(s.tables[index], playerId, action, ctx);
    if (!res.ok) return res;
    collect(s, index, res, out);
    settle(s, ctx, out);
    return ok(s, out.events, out.ledger);
  },

  tick(prev, ctx) {
    if (prev.finished) return null;
    const due = prev.tables
      .map((t, i) => ({ t, i, d: pokerEngine.deadline(t) }))
      .filter(({ d }) => d !== null && d <= ctx.now);
    if (!due.length) return null;
    const s = clone(prev);
    const out: Out = { events: [], ledger: [] };
    for (const { i } of due) {
      const t = s.tables[i];
      // Blinds for the coming hand follow the tournament clock.
      if (t.phase === 'handComplete') t.config = tableConfig(s.config, levelAt(s, ctx.now));
      const res = pokerEngine.tick(t, ctx);
      if (res) collect(s, i, res, out);
    }
    settle(s, ctx, out);
    return ok(s, out.events, out.ledger);
  },

  deadline(s) {
    if (s.finished) return null;
    const ds = s.tables.map((t) => pokerEngine.deadline(t)).filter((d): d is number => d !== null);
    return ds.length ? Math.min(...ds) : null;
  },

  isFinished: (s) => s.finished,

  placements(s) {
    if (!s.finished) return null;
    return Object.entries(s.places)
      .sort((a, b) => a[1] - b[1])
      .map<Placement>(([playerId, place]) => ({ playerId, placement: place, outcome: place === 1 ? 'win' : 'loss' }));
  },

  view(s, viewerId) {
    const mine = s.tables.find((t) => t.players.some((p) => p.playerId === viewerId && p.status === 'active'));
    const shown = mine ?? [...s.tables].sort((a, b) => alive(b).length - alive(a).length)[0];
    const v = pokerEngine.view(shown, viewerId);
    const level = Math.max(0, (POKER_TOURNAMENT_BIG_BLINDS as readonly number[]).indexOf(shown.config.bigBlind));
    const next = pokerMttLevel(level + 1);
    const lastLevel = next.bigBlind === shown.config.bigBlind;
    const stacks = s.tables.flatMap((t) => alive(t).map((p) => ({ id: p.playerId, chips: chipsOf(t, p) }))).sort((a, b) => b.chips - a.chips);
    const total = stacks.reduce((n, x) => n + x.chips, 0);
    const pool = mttPrizePool(s);
    const rank = stacks.findIndex((x) => x.id === viewerId);
    return {
      ...v,
      phase: s.finished ? 'finished' : v.phase,
      tournament: {
        kind: 'mtt',
        name: s.config.name ?? 'Tournament',
        level: level + 1,
        smallBlind: shown.config.smallBlind,
        bigBlind: shown.config.bigBlind,
        ante: shown.config.ante ?? 0,
        nextSmallBlind: lastLevel ? null : next.smallBlind,
        nextBigBlind: lastLevel ? null : next.bigBlind,
        nextAnte: lastLevel ? null : next.ante,
        handsToNextLevel: 0,
        levelEndsAt: lastLevel ? null : s.startedAt + (level + 1) * levelMs(s.config),
        startedAt: s.startedAt,
        lateRegEndsAt: lateRegEndsAt(s),
        prizePool: pool,
        payouts: pokerMttPayouts(pool, s.entrants),
        entrants: s.entrants,
        playersLeft: stacks.length,
        tables: s.tables.length,
        tableNumber: shown.tableId ?? null,
        stacks: stacks.length
          ? { min: stacks[stacks.length - 1].chips, avg: Math.round(total / stacks.length), max: stacks[0].chips }
          : { min: 0, avg: 0, max: 0 },
        myRank: rank >= 0 ? rank + 1 : null,
        myPlace: viewerId ? (s.places[viewerId] ?? null) : null,
      },
    };
  },
};

const isMttState = (s: unknown): s is PokerMttState => (s as PokerMttState | null)?.kind === 'mtt';

/** The engine registered for poker: scheduled tournaments go to the multi-table wrapper, everything else is one table. */
export const pokerGameEngine: GameEngine<PokerState | PokerMttState, PokerConfig, PokerView> = {
  slug: 'poker',
  parseConfig: (input, stake) => (asRecord(input).mode === 'mtt' ? parseMttConfig(input, stake) : pokerEngine.parseConfig(input, stake)),
  playerLimits: (c) => (c.mode === 'mtt' ? pokerMttEngine.playerLimits(c) : pokerEngine.playerLimits(c)),
  start: (players, c, ctx) => (c.mode === 'mtt' ? pokerMttEngine.start(players, c, ctx) : pokerEngine.start(players, c, ctx)),
  act: (s, id, a, ctx) => (isMttState(s) ? pokerMttEngine.act(s, id, a, ctx) : pokerEngine.act(s, id, a, ctx)),
  tick: (s, ctx) => (isMttState(s) ? pokerMttEngine.tick(s, ctx) : pokerEngine.tick(s, ctx)),
  deadline: (s) => (isMttState(s) ? pokerMttEngine.deadline(s) : pokerEngine.deadline(s)),
  isFinished: (s) => (isMttState(s) ? pokerMttEngine.isFinished(s) : pokerEngine.isFinished(s)),
  placements: (s) => (isMttState(s) ? pokerMttEngine.placements(s) : pokerEngine.placements(s)),
  view: (s, v) => (isMttState(s) ? pokerMttEngine.view(s, v) : pokerEngine.view(s, v)),
  participants: (s) => (isMttState(s) ? null : pokerEngine.participants!(s)),
  seatOf: (s, id) => {
    if (!isMttState(s)) return pokerEngine.seatOf!(s, id);
    for (const t of s.tables) {
      const p = t.players.find((x) => x.playerId === id);
      if (p) return (t.tableId ?? 0) * 10 + p.seat;
    }
    return null;
  },
};
