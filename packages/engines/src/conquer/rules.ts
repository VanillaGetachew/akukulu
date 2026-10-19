/**
 * Ethiopian Conquer rule primitives: wildcard prediction, card values,
 * meld interpretation (sets/runs with wildcards), lay-offs and penalties.
 * Everything here is pure and independently tested.
 */
import {
  SUITS,
  cardRank,
  cardSuit,
  type Card,
  type ConquerPrediction,
  type ConquerRules,
  type Rank,
  type Suit,
} from '@akukulu/shared';

/** Rank order used for runs and for Up/Down: A,2,…,10,J,Q,K. */
export const RUN_RANKS: readonly Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
const RED: readonly Suit[] = ['h', 'd'];

export const isRed = (s: Suit) => RED.includes(s);

/** Natural value: Ace 11, 2–10 face value, J/Q/K 10. */
export function naturalValue(rank: Rank): number {
  if (rank === 'A') return 11;
  if (rank === 'T' || rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

/** Position of a rank in a run: A=1 (or 14 when high), 2…K = 2…13. */
function lowPosition(rank: Rank): number {
  return RUN_RANKS.indexOf(rank) + 1;
}

function rankAtPosition(pos: number): Rank {
  return RUN_RANKS[(pos - 1) % 13];
}

/** Points of a card identity at a run position (Ace low = 1, Ace high = 11). */
function runPoints(pos: number): number {
  if (pos === 1) return 1;
  if (pos === 14) return 11;
  return naturalValue(rankAtPosition(pos));
}

/* ------------------------------------------------------------------ */
/* Wildcard prediction                                                 */
/* ------------------------------------------------------------------ */

export interface WildSelection {
  ranks: Rank[];
  /** null = every suit of those ranks. */
  suits: Suit[] | null;
  cards: Card[];
}

function stepRank(base: Rank, delta: number, boundary: ConquerRules['prediction']['boundary']): Rank {
  const n = RUN_RANKS.indexOf(base) + delta;
  if (n >= 0 && n < 13) return RUN_RANKS[n];
  return boundary === 'wrap' ? RUN_RANKS[(n + 13) % 13] : base;
}

/**
 * Wildcards selected by a prediction on the base card. Isolated so the mapping
 * can be confirmed or changed through `rules.prediction` without touching the engine.
 */
export function selectWildcards(base: Card, choice: ConquerPrediction, rules: ConquerRules): WildSelection {
  const rank = cardRank(base);
  const suit = cardSuit(base);
  const p = rules.prediction;
  let ranks: Rank[];
  let suits: Suit[] | null = null;
  switch (choice) {
    case 'up':
      ranks = [stepRank(rank, p.up, p.boundary)];
      break;
    case 'down':
      ranks = [stepRank(rank, p.down, p.boundary)];
      break;
    case 'upDown':
      ranks = [...new Set([stepRank(rank, p.up, p.boundary), stepRank(rank, p.down, p.boundary)])];
      break;
    case 'side':
      ranks = [rank];
      if (p.side === 'sameRankSameColor') suits = SUITS.filter((s) => isRed(s) === isRed(suit));
      if (p.side === 'sameRankOtherColor') suits = SUITS.filter((s) => isRed(s) !== isRed(suit));
      break;
  }
  const cards = ranks.flatMap((r) => (suits ?? SUITS).map((s) => `${r}${s}`));
  return { ranks, suits, cards };
}

/* ------------------------------------------------------------------ */
/* Melds                                                               */
/* ------------------------------------------------------------------ */

export interface Placed {
  card: Card;
  /** Identity represented; equals `card` for natural use. */
  as: Card;
  /** True when the card substitutes for another identity. */
  wild: boolean;
  points: number;
  /** Run position (1–14) for runs. */
  pos?: number;
}

export interface Interpretation {
  kind: 'set' | 'run';
  /** Sets in suit order; runs from low to high. */
  placed: Placed[];
  points: number;
}

export interface MeldContext {
  /** Physical wildcards this round. */
  wild: ReadonlySet<Card>;
  rules: ConquerRules;
  /** Identities already represented on the table (natural or wild). */
  taken: ReadonlySet<Card>;
}

export type MeldResult = { ok: true; meld: Interpretation } | { ok: false; error: string };

const fail = (error: string): MeldResult => ({ ok: false, error });
const total = (placed: Placed[]) => placed.reduce((s, p) => s + p.points, 0);
const naturals = (placed: Placed[]) => placed.filter((p) => !p.wild).length;

function setCandidate(cards: Card[], rank: Rank, ctx: MeldContext, hint: Record<Card, Card>): Interpretation | null {
  if (cards.length < 3 || cards.length > 4) return null;
  const used = new Set<Suit>();
  const placed: Placed[] = [];
  const flexible: Card[] = [];
  for (const c of cards) {
    if (ctx.wild.has(c)) flexible.push(c);
    else if (cardRank(c) !== rank || used.has(cardSuit(c))) return null;
    else {
      used.add(cardSuit(c));
      placed.push({ card: c, as: c, wild: false, points: naturalValue(rank) });
    }
  }
  // Wildcards of this rank play as themselves when their suit is still free (unless pinned elsewhere).
  const substitutes: Card[] = [];
  for (const c of flexible) {
    if (cardRank(c) === rank && !used.has(cardSuit(c)) && (!hint[c] || hint[c] === c)) {
      used.add(cardSuit(c));
      placed.push({ card: c, as: c, wild: false, points: naturalValue(rank) });
    } else substitutes.push(c);
  }
  for (const c of substitutes) {
    const options = SUITS.filter((s) => !used.has(s) && !ctx.taken.has(`${rank}${s}`)).map((s) => `${rank}${s}`);
    const as = hint[c] ? (options.includes(hint[c]) ? hint[c] : null) : options[0];
    if (!as) return null;
    used.add(cardSuit(as));
    placed.push({ card: c, as, wild: true, points: naturalValue(rank) });
  }
  if (naturals(placed) < ctx.rules.wild.minNaturalPerMeld) return null;
  if (placed.some((p) => !p.wild && ctx.taken.has(p.as))) return null;
  placed.sort((a, b) => SUITS.indexOf(cardSuit(a.as)) - SUITS.indexOf(cardSuit(b.as)));
  return { kind: 'set', placed, points: total(placed) };
}

function runCandidates(cards: Card[], suit: Suit, ctx: MeldContext, hint: Record<Card, Card>): Interpretation[] {
  const L = cards.length;
  const maxPos = ctx.rules.runs.aceHigh ? 14 : 13;
  const out: Interpretation[] = [];
  for (let start = 1; start + L - 1 <= maxPos; start++) {
    const end = start + L - 1;
    const slotOf = (c: Card): number | null => {
      if (cardSuit(c) !== suit) return null;
      const r = cardRank(c);
      if (r === 'A') return start === 1 ? 1 : end === 14 ? 14 : null;
      const p = lowPosition(r);
      return p >= start && p <= end ? p : null;
    };
    const filled = new Map<number, Placed>();
    const flexible: Card[] = [];
    let valid = true;
    for (const c of cards) {
      if (ctx.wild.has(c)) {
        flexible.push(c);
        continue;
      }
      const pos = slotOf(c);
      if (pos === null || filled.has(pos)) {
        valid = false;
        break;
      }
      filled.set(pos, { card: c, as: c, wild: false, points: runPoints(pos), pos });
    }
    if (!valid) continue;
    const substitutes: Card[] = [];
    for (const c of flexible) {
      const pos = slotOf(c);
      if (pos !== null && !filled.has(pos) && (!hint[c] || hint[c] === c)) {
        filled.set(pos, { card: c, as: c, wild: false, points: runPoints(pos), pos });
      } else substitutes.push(c);
    }
    const open = (): number[] => {
      const free: number[] = [];
      for (let p = start; p <= end; p++) if (!filled.has(p)) free.push(p);
      return free;
    };
    // Pinned wildcards first, then the rest fill remaining slots low to high.
    const pinned = substitutes.filter((c) => hint[c]);
    const rest = substitutes.filter((c) => !hint[c]);
    for (const c of [...pinned, ...rest]) {
      const free = open().filter((p) => !ctx.taken.has(`${rankAtPosition(p)}${suit}`));
      const pos = hint[c] ? free.find((p) => `${rankAtPosition(p)}${suit}` === hint[c]) : free[0];
      if (pos === undefined) {
        valid = false;
        break;
      }
      filled.set(pos, { card: c, as: `${rankAtPosition(pos)}${suit}`, wild: true, points: runPoints(pos), pos });
    }
    if (!valid || filled.size !== L) continue;
    const placed = [...filled.values()].sort((a, b) => a.pos! - b.pos!);
    if (naturals(placed) < ctx.rules.wild.minNaturalPerMeld) continue;
    if (placed.some((p) => !p.wild && ctx.taken.has(p.as))) continue;
    out.push({ kind: 'run', placed, points: total(placed) });
  }
  return out;
}

/**
 * Validates a proposed meld. When several readings are valid (a wildcard that
 * could extend a run at either end, or an Ace that could sit low or high) the
 * `hint` pins what each wildcard represents; otherwise the highest-scoring
 * reading is chosen.
 */
export function interpretMeld(cards: Card[], ctx: MeldContext, hint: Record<Card, Card> = {}): MeldResult {
  if (cards.length < 3) return fail('A meld needs at least three cards');
  if (new Set(cards).size !== cards.length) return fail('A card cannot appear twice in a meld');
  const represented = cards.find((c) => !ctx.wild.has(c) && ctx.taken.has(c));
  if (represented) return fail(`A wildcard already represents ${represented} — swap it instead`);
  for (const [c, as] of Object.entries(hint)) {
    if (!cards.includes(c)) return fail(`Hint refers to ${c}, which is not in the meld`);
    if (!ctx.wild.has(c) && as !== c) return fail(`${c} is not a wildcard this round`);
  }
  const candidates: Interpretation[] = [];
  for (const rank of new Set(cards.map(cardRank))) {
    const set = setCandidate(cards, rank, ctx, hint);
    if (set) candidates.push(set);
  }
  for (const suit of new Set(cards.map(cardSuit))) candidates.push(...runCandidates(cards, suit, ctx, hint));
  if (candidates.length === 0) {
    const naturalCount = cards.filter((c) => !ctx.wild.has(c)).length;
    if (naturalCount < ctx.rules.wild.minNaturalPerMeld && naturalCount < cards.length) {
      return fail(`Each meld needs at least ${ctx.rules.wild.minNaturalPerMeld} natural cards`);
    }
    return fail('Not a valid set or run');
  }
  candidates.sort((a, b) => b.points - a.points || (a.kind === 'set' ? -1 : 1));
  return { ok: true, meld: candidates[0] };
}

/** Adds one card to an existing meld, keeping every existing identity fixed. */
export function extendMeld(meld: Interpretation, card: Card, ctx: MeldContext, hintAs?: Card): MeldResult {
  const isWild = ctx.wild.has(card);
  if (hintAs && !isWild && hintAs !== card) return fail(`${card} is not a wildcard this round`);
  if (meld.kind === 'set') {
    const rank = cardRank(meld.placed[0].as);
    if (meld.placed.length >= 4) return fail('A set has at most four cards');
    const used = new Set(meld.placed.map((p) => cardSuit(p.as)));
    const fitsAsItself = cardRank(card) === rank && !used.has(cardSuit(card));
    let as: Card | null;
    if (fitsAsItself && (!hintAs || hintAs === card)) {
      as = card;
      if (ctx.taken.has(card)) return fail(`A wildcard already represents ${card} — swap it instead`);
    } else if (!isWild) {
      return fail(`${card} does not fit this set`);
    } else {
      const options = SUITS.filter((s) => !used.has(s) && !ctx.taken.has(`${rank}${s}`)).map((s) => `${rank}${s}`);
      as = hintAs ? (options.includes(hintAs) ? hintAs : null) : (options[0] ?? null);
      if (!as) return fail('No free position in this set');
    }
    const placed = [...meld.placed, { card, as, wild: as !== card, points: naturalValue(rank) }].sort(
      (a, b) => SUITS.indexOf(cardSuit(a.as)) - SUITS.indexOf(cardSuit(b.as)),
    );
    return { ok: true, meld: { kind: 'set', placed, points: total(placed) } };
  }

  const suit = cardSuit(meld.placed[0].as);
  const low = meld.placed[0].pos!;
  const high = meld.placed[meld.placed.length - 1].pos!;
  const maxPos = ctx.rules.runs.aceHigh ? 14 : 13;
  const ends = [high + 1, low - 1].filter((p) => p >= 1 && p <= maxPos);
  const identity = (p: number) => `${rankAtPosition(p)}${suit}`;
  let pos: number | undefined;
  if (!isWild || !hintAs || hintAs === card) pos = ends.find((p) => identity(p) === card);
  if (pos === undefined && !isWild) return fail(`${card} does not extend this run`);
  let wild = false;
  if (pos === undefined) {
    const free = ends.filter((p) => !ctx.taken.has(identity(p)));
    pos = hintAs ? free.find((p) => identity(p) === hintAs) : free[0];
    if (pos === undefined) return fail('This run cannot be extended');
    wild = true;
  }
  if (!wild && ctx.taken.has(card)) return fail(`A wildcard already represents ${card} — swap it instead`);
  const placed = [...meld.placed, { card, as: identity(pos), wild, points: runPoints(pos), pos }].sort((a, b) => a.pos! - b.pos!);
  return { ok: true, meld: { kind: 'run', placed, points: total(placed) } };
}

/** Opening value of a meld under `rules.wild.openingValue`. */
export function openingPoints(meld: Interpretation, rules: ConquerRules): number {
  const fixed = rules.wild.openingValue;
  return meld.placed.reduce((s, p) => s + (p.wild && typeof fixed === 'number' ? fixed : p.points), 0);
}

/** Penalty for a card left in hand when the stock runs out. */
export function penaltyValue(card: Card, wild: ReadonlySet<Card>, rules: ConquerRules): number {
  if (wild.has(card) && typeof rules.wild.penalty === 'number') return rules.wild.penalty;
  return cardRank(card) === 'A' ? rules.acePenalty : naturalValue(cardRank(card));
}

/* ------------------------------------------------------------------ */
/* Suggestions (used by tests/simulations and as a UI hint)            */
/* ------------------------------------------------------------------ */

/** Greedy search for natural melds in a hand (no wildcards). */
export function suggestNaturalMelds(hand: Card[], ctx: MeldContext): Interpretation[] {
  const left = new Set(hand);
  const found: Interpretation[] = [];
  const take = (cards: Card[]) => {
    const res = interpretMeld(cards, ctx);
    if (res.ok) {
      found.push(res.meld);
      for (const c of cards) left.delete(c);
    }
  };
  for (const suit of SUITS) {
    const positions = [...left]
      .filter((c) => cardSuit(c) === suit && !ctx.wild.has(c))
      .map((c) => lowPosition(cardRank(c)))
      .sort((a, b) => a - b);
    let runStart = 0;
    for (let i = 1; i <= positions.length; i++) {
      if (i === positions.length || positions[i] !== positions[i - 1] + 1) {
        if (i - runStart >= 3) take(positions.slice(runStart, i).map((p) => `${rankAtPosition(p)}${suit}`));
        runStart = i;
      }
    }
  }
  const byRank = new Map<Rank, Card[]>();
  for (const c of left) if (!ctx.wild.has(c)) byRank.set(cardRank(c), [...(byRank.get(cardRank(c)) ?? []), c]);
  for (const cards of byRank.values()) if (cards.length >= 3) take(cards.slice(0, 4));
  return found;
}
