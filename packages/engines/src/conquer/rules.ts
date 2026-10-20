/**
 * Ethiopian Conquer rule primitives: wildcard prediction, card values,
 * meld interpretation (sets/runs with wildcards), lay-offs and penalties.
 * Everything here is pure and independently tested.
 */
import {
  SUITS,
  cardRank,
  cardSuit,
  isPrintedJoker,
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

/** Sets are laid out alternating red and black, as players lay them: ♥ ♣ ♦ ♠. */
const SET_ORDER: readonly Suit[] = ['h', 'c', 'd', 's'];
const bySetOrder = (a: { as: Card }, b: { as: Card }) => SET_ORDER.indexOf(cardSuit(a.as)) - SET_ORDER.indexOf(cardSuit(b.as));

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
  const { mapping, boundary } = rules.prediction;
  const rule = mapping[choice];
  const ranks = [...new Set(rule.steps.map((step) => stepRank(rank, step, boundary)))];
  let suits: Suit[] | null;
  switch (rule.suits) {
    case 'sameSuit':
      suits = [suit];
      break;
    case 'sameColor':
      suits = SUITS.filter((s) => isRed(s) === isRed(suit));
      break;
    case 'otherColor':
      suits = SUITS.filter((s) => isRed(s) !== isRed(suit));
      break;
    default:
      suits = null;
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
  /** Cards a printed (false) joker may copy this round — the chosen joker cards. */
  falseJokerAs?: readonly Card[];
}

export type MeldResult = { ok: true; meld: Interpretation } | { ok: false; error: string };

const fail = (error: string): MeldResult => ({ ok: false, error });
const total = (placed: Placed[]) => placed.reduce((s, p) => s + p.points, 0);
const naturals = (placed: Placed[]) => placed.filter((p) => !p.wild).length;
const jokersUsed = (placed: Placed[]) => placed.filter((p) => p.wild).length;
/** A meld may hold at most `rules.wild.maxPerMeld` substituting jokers (one, by default). */
const tooManyJokers = (placed: Placed[], ctx: MeldContext) => jokersUsed(placed) > ctx.rules.wild.maxPerMeld;

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
  if (naturals(placed) < ctx.rules.wild.minNaturalPerMeld || tooManyJokers(placed, ctx)) return null;
  if (placed.some((p) => !p.wild && ctx.taken.has(p.as))) return null;
  placed.sort(bySetOrder);
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
    if (naturals(placed) < ctx.rules.wild.minNaturalPerMeld || tooManyJokers(placed, ctx)) continue;
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
function interpretMeldPlain(cards: Card[], ctx: MeldContext, hint: Record<Card, Card> = {}): MeldResult {
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
function extendMeldPlain(meld: Interpretation, card: Card, ctx: MeldContext, hintAs?: Card): MeldResult {
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
    if (as !== card && jokersUsed(meld.placed) >= ctx.rules.wild.maxPerMeld) return fail('Only one joker may be used in a meld');
    const placed = [...meld.placed, { card, as, wild: as !== card, points: naturalValue(rank) }].sort(
      bySetOrder,
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
  if (wild && jokersUsed(meld.placed) >= ctx.rules.wild.maxPerMeld) return fail('Only one joker may be used in a meld');
  const placed = [...meld.placed, { card, as: identity(pos), wild, points: runPoints(pos), pos }].sort((a, b) => a.pos! - b.pos!);
  return { ok: true, meld: { kind: 'run', placed, points: total(placed) } };
}

/** Opening value of a meld under `rules.wild.openingValue`. */
export function openingPoints(meld: Interpretation, rules: ConquerRules): number {
  const fixed = rules.wild.openingValue;
  return meld.placed.reduce((s, p) => s + (p.wild && typeof fixed === 'number' ? fixed : p.points), 0);
}

/** Penalty for a card left in hand when the stock runs out. */
function penaltyValuePlain(card: Card, wild: ReadonlySet<Card>, rules: ConquerRules): number {
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
    const res = interpretMeldPlain(cards, ctx);
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

/* ------------------------------------------------------------------ */
/* Optimal grouping: hand arrangement and meld partitioning            */
/* ------------------------------------------------------------------ */

interface Candidate {
  /** Natural (non-wild) cards used. */
  naturals: Card[];
  /** Wildcards needed to complete it. */
  wilds: number;
  points: number;
}

/** Every set and run (with up to the available wildcards filling gaps) that could be made from `cards`. */
function candidates(cards: Card[], ctx: MeldContext): Candidate[] {
  const natural = cards.filter((c) => !ctx.wild.has(c));
  const wildCount = cards.length - natural.length;
  const minNat = Math.max(1, ctx.rules.wild.minNaturalPerMeld);
  const out: Candidate[] = [];

  // Sets: any 1–4 naturals of a rank plus wildcards, 3–4 cards in total.
  const byRank = new Map<Rank, Card[]>();
  for (const c of natural) byRank.set(cardRank(c), [...(byRank.get(cardRank(c)) ?? []), c]);
  for (const [rank, group] of byRank) {
    const n = group.length;
    for (let mask = 1; mask < 1 << n; mask++) {
      const picked = group.filter((_, i) => mask & (1 << i));
      if (picked.length < minNat) continue;
      const maxW = Math.min(wildCount, ctx.rules.wild.maxPerMeld);
      for (let w = Math.max(0, 3 - picked.length); picked.length + w <= 4 && w <= maxW; w++) {
        out.push({ naturals: picked, wilds: w, points: naturalValue(rank) * (picked.length + w) });
      }
    }
  }

  // Runs: every window of positions in a suit, filled by the naturals present and wildcards.
  const maxPos = ctx.rules.runs.aceHigh ? 14 : 13;
  for (const suit of SUITS) {
    const at = new Map<number, Card>();
    for (const c of natural) {
      if (cardSuit(c) !== suit) continue;
      const pos = lowPosition(cardRank(c));
      at.set(pos, c);
      if (pos === 1 && maxPos === 14) at.set(14, c);
    }
    for (let start = 1; start <= maxPos - 2; start++) {
      for (let end = start + 2; end <= maxPos && end - start < 13; end++) {
        const present: Card[] = [];
        let points = 0;
        for (let p = start; p <= end; p++) {
          points += runPoints(p);
          const c = at.get(p);
          if (c && !present.includes(c)) present.push(c);
        }
        const len = end - start + 1;
        const missing = len - present.length;
        // Widening a window never closes a gap, so stop once there are too many.
        if (missing > Math.min(wildCount, ctx.rules.wild.maxPerMeld)) break;
        if (present.length >= minNat) out.push({ naturals: present, wilds: missing, points });
      }
    }
  }
  return out;
}

interface Choice {
  picks: Candidate[];
  covered: number;
  points: number;
}

/**
 * Exhaustive (bounded) search for non-overlapping candidates. With `exact`,
 * only selections that use every card are returned.
 */
function bestCover(cards: Card[], ctx: MeldContext, exact: boolean): Choice | null {
  const all = candidates(cards, ctx);
  const naturalCount = cards.filter((c) => !ctx.wild.has(c)).length;
  const wildCount = cards.length - naturalCount;
  let best: Choice | null = exact ? null : { picks: [], covered: 0, points: 0 };
  let nodes = 0;
  const used = new Set<Card>();
  const picks: Candidate[] = [];
  const better = (covered: number, points: number) =>
    !best || covered > best.covered || (covered === best.covered && points > best.points);

  const dfs = (from: number, wildsLeft: number, covered: number, points: number) => {
    if (++nodes > 60_000) return;
    const isExact = covered === cards.length;
    if ((!exact || isExact) && better(covered, points)) best = { picks: [...picks], covered, points };
    for (let i = from; i < all.length; i++) {
      const c = all[i];
      if (c.wilds > wildsLeft || c.naturals.some((n) => used.has(n))) continue;
      for (const n of c.naturals) used.add(n);
      picks.push(c);
      dfs(i + 1, wildsLeft - c.wilds, covered + c.naturals.length + c.wilds, points + c.points);
      picks.pop();
      for (const n of c.naturals) used.delete(n);
    }
  };
  dfs(0, wildCount, 0, 0);
  return best;
}

/** Turns chosen candidates into concrete melds, assigning the actual wildcards. */
function materialise(choice: Choice, cards: Card[], ctx: MeldContext): Card[][] {
  const wilds = cards.filter((c) => ctx.wild.has(c));
  return choice.picks.map((p) => [...p.naturals, ...wilds.splice(0, p.wilds)]);
}

/**
 * Splits `cards` into valid melds that use every card, or returns null.
 * Lets a player simply select the cards to lay down.
 */
function partitionIntoMeldsPlain(cards: Card[], ctx: MeldContext): Card[][] | null {
  if (cards.length < 3) return null;
  const choice = bestCover(cards, ctx, true);
  if (!choice) return null;
  const melds = materialise(choice, cards, ctx);
  return melds.every((m) => interpretMeldPlain(m, ctx).ok) ? melds : null;
}

/**
 * The "optimum order" for a hand: the best combination of melds first (each in
 * playing order, wildcards in the gap they fill), then the remaining cards by
 * suit and rank, wildcards last.
 */
function arrangeHandPlain(hand: Card[], ctx: MeldContext): { order: Card[]; melds: Card[][] } {
  const choice = bestCover(hand, ctx, false)!;
  const melds: Card[][] = [];
  for (const cards of materialise(choice, hand, ctx)) {
    const res = interpretMeldPlain(cards, ctx);
    if (res.ok) melds.push(res.meld.placed.map((p) => p.card));
  }
  const inMelds = new Set(melds.flat());
  const suitOrder = (c: Card) => SUITS.indexOf(cardSuit(c));
  const rest = hand
    .filter((c) => !inMelds.has(c))
    .sort((a, b) => Number(ctx.wild.has(a)) - Number(ctx.wild.has(b)) || suitOrder(a) - suitOrder(b) || lowPosition(cardRank(a)) - lowPosition(cardRank(b)));
  return { order: [...melds.flat(), ...rest], melds };
}

/* ------------------------------------------------------------------ */
/* Joker choices                                                       */
/* ------------------------------------------------------------------ */

const identityKey = (m: Interpretation) => `${m.kind}:${m.placed.map((p) => p.as).sort().join(',')}`;

function* combinations<T>(items: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield acc;
    return;
  }
  for (let i = start; i < items.length; i++) yield* combinations(items, k, i + 1, [...acc, items[i]]);
}

/**
 * Every distinct valid reading of a meld (what each joker stands for), best
 * first. A single entry means there is nothing for the player to choose.
 */
function meldOptionsPlain(cards: Card[], ctx: MeldContext): Interpretation[] {
  if (cards.length < 3 || new Set(cards).size !== cards.length) return [];
  if (cards.some((c) => !ctx.wild.has(c) && ctx.taken.has(c))) return [];
  const found = new Map<string, Interpretation>();
  const add = (m: Interpretation | null) => {
    if (m && !found.has(identityKey(m))) found.set(identityKey(m), m);
  };
  for (const rank of new Set(cards.map(cardRank))) {
    const naturalSuits = new Set(cards.filter((c) => !ctx.wild.has(c) && cardRank(c) === rank).map(cardSuit));
    const jokers = cards.filter((c) => ctx.wild.has(c));
    // Jokers of this rank may play as themselves; the rest pick any free suit.
    const selfPlaying = jokers.filter((c) => cardRank(c) === rank && !naturalSuits.has(cardSuit(c)));
    const substitutes = jokers.filter((c) => !selfPlaying.includes(c));
    const used = new Set([...naturalSuits, ...selfPlaying.map(cardSuit)]);
    const free = SUITS.filter((s) => !used.has(s) && !ctx.taken.has(`${rank}${s}`));
    if (substitutes.length === 0) add(setCandidate(cards, rank, ctx, {}));
    for (const suits of combinations(free, substitutes.length)) {
      const hint: Record<Card, Card> = {};
      substitutes.forEach((c, i) => (hint[c] = `${rank}${suits[i]}`));
      add(setCandidate(cards, rank, ctx, hint));
    }
  }
  for (const suit of new Set(cards.map(cardSuit))) for (const run of runCandidates(cards, suit, ctx, {})) add(run);
  return [...found.values()].sort((a, b) => b.points - a.points);
}

/** Every distinct way to lay `card` off on `meld` (a joker may fit either end of a run, or any free suit of a set). */
function layoffOptionsPlain(meld: Interpretation, card: Card, ctx: MeldContext): Interpretation[] {
  const results = new Map<string, Interpretation>();
  const tryAs = (as?: Card) => {
    const r = extendMeldPlain(meld, card, ctx, as);
    if (r.ok && !results.has(identityKey(r.meld))) results.set(identityKey(r.meld), r.meld);
  };
  tryAs(undefined);
  if (ctx.wild.has(card)) {
    if (meld.kind === 'set') {
      const rank = cardRank(meld.placed[0].as);
      for (const s of SUITS) tryAs(`${rank}${s}`);
    } else {
      const suit = cardSuit(meld.placed[0].as);
      const low = meld.placed[0].pos!;
      const high = meld.placed[meld.placed.length - 1].pos!;
      for (const p of [low - 1, high + 1]) if (p >= 1 && p <= 14) tryAs(`${rankAtPosition(p)}${suit}`);
    }
  }
  return [...results.values()].sort((a, b) => b.points - a.points);
}

/* ------------------------------------------------------------------ */
/* False (printed) jokers                                              */
/* ------------------------------------------------------------------ */
//
// A printed joker is not a joker: it is a copy of one of this round's chosen
// joker cards (owner-confirmed). With base 5♦ and "Up", a printed joker can only
// be 6♦ or 6♥, played as that card. Each function below resolves every printed
// joker to each card it may copy, runs the ordinary rules, and maps back.

interface Resolution {
  cards: Card[];
  ctx: MeldContext;
  /** identity → physical printed joker */
  back: Map<Card, Card>;
}

/** Every way to read the printed jokers in `cards` as distinct chosen cards. */
function resolutions(cards: Card[], ctx: MeldContext, pinned: Record<Card, Card> = {}): Resolution[] {
  const printed = cards.filter((c) => isPrintedJoker(c));
  if (printed.length === 0) return [{ cards, ctx, back: new Map() }];
  const options = (ctx.falseJokerAs ?? []).filter((id) => !cards.includes(id));
  const out: Resolution[] = [];
  const walk = (i: number, chosen: Card[]) => {
    if (i === printed.length) {
      const back = new Map(chosen.map((id, k) => [id, printed[k]]));
      // The copied cards play as themselves: they are not jokers here.
      const wild = new Set([...ctx.wild].filter((w) => !back.has(w)));
      out.push({ cards: cards.map((c) => (isPrintedJoker(c) ? chosen[printed.indexOf(c)] : c)), ctx: { ...ctx, wild }, back });
      return;
    }
    const allowed = pinned[printed[i]] ? options.filter((o) => o === pinned[printed[i]]) : options;
    for (const id of allowed) if (!chosen.includes(id)) walk(i + 1, [...chosen, id]);
  };
  walk(0, []);
  return out;
}

const mapBack = (m: Interpretation, back: Map<Card, Card>): Interpretation =>
  back.size ? { ...m, placed: m.placed.map((p) => (back.has(p.card) ? { ...p, card: back.get(p.card)! } : p)) } : m;

const unhint = (hint: Record<Card, Card>) => Object.fromEntries(Object.entries(hint).filter(([k]) => !isPrintedJoker(k)));

const noCopyError = 'A false joker can only be played as one of this round\u2019s chosen cards';

export function interpretMeld(cards: Card[], ctx: MeldContext, hint: Record<Card, Card> = {}): MeldResult {
  const res = resolutions(cards, ctx, hint);
  if (res.length === 0) return fail(noCopyError);
  let firstError: string | null = null;
  let best: Interpretation | null = null;
  for (const r of res) {
    const out = interpretMeldPlain(r.cards, r.ctx, unhint(hint));
    if (!out.ok) {
      firstError ??= out.error;
      continue;
    }
    const m = mapBack(out.meld, r.back);
    if (!best || m.points > best.points) best = m;
  }
  return best ? { ok: true, meld: best } : fail(firstError ?? noCopyError);
}

export function meldOptions(cards: Card[], ctx: MeldContext): Interpretation[] {
  const seen = new Map<string, Interpretation>();
  for (const r of resolutions(cards, ctx)) {
    for (const m of meldOptionsPlain(r.cards, r.ctx)) {
      const mapped = mapBack(m, r.back);
      const key = `${mapped.kind}:${mapped.placed.map((p) => `${p.card}=${p.as}`).sort().join(',')}`;
      if (!seen.has(key)) seen.set(key, mapped);
    }
  }
  return [...seen.values()].sort((a, b) => b.points - a.points);
}

/** Adds one card to a meld; a printed joker goes on as one of the chosen cards. */
export function extendMeld(meld: Interpretation, card: Card, ctx: MeldContext, hintAs?: Card): MeldResult {
  if (!isPrintedJoker(card)) {
    // A card and a false joker copying it never share a meld.
    if (meld.placed.some((p) => isPrintedJoker(p.card) && p.as === card)) return fail(`A false joker in this meld already copies ${card}`);
    return extendMeldPlain(meld, card, ctx, hintAs);
  }
  const inMeld = new Set(meld.placed.map((p) => p.card));
  const ids = (ctx.falseJokerAs ?? []).filter((id) => (!hintAs || id === hintAs) && !inMeld.has(id));
  let firstError: string | null = null;
  for (const id of ids) {
    const out = extendMeldPlain(meld, id, { ...ctx, wild: new Set([...ctx.wild].filter((w) => w !== id)) });
    if (out.ok) return { ok: true, meld: mapBack(out.meld, new Map([[id, card]])) };
    firstError ??= out.error;
  }
  return fail(firstError ?? noCopyError);
}

export function layoffOptions(meld: Interpretation, card: Card, ctx: MeldContext): Interpretation[] {
  if (!isPrintedJoker(card)) return layoffOptionsPlain(meld, card, ctx);
  const found: Interpretation[] = [];
  for (const id of ctx.falseJokerAs ?? []) {
    const out = extendMeld(meld, card, ctx, id);
    if (out.ok) found.push(out.meld);
  }
  return found.sort((a, b) => b.points - a.points);
}

export function partitionIntoMelds(cards: Card[], ctx: MeldContext): Card[][] | null {
  for (const r of resolutions(cards, ctx)) {
    const melds = partitionIntoMeldsPlain(r.cards, r.ctx);
    if (melds) return melds.map((m) => m.map((c) => r.back.get(c) ?? c));
  }
  return null;
}

export function arrangeHand(hand: Card[], ctx: MeldContext): { order: Card[]; melds: Card[][] } {
  let best: { order: Card[]; melds: Card[][] } | null = null;
  for (const r of resolutions(hand, ctx)) {
    const out = arrangeHandPlain(r.cards, r.ctx);
    const mapped = { order: out.order.map((c) => r.back.get(c) ?? c), melds: out.melds.map((m) => m.map((c) => r.back.get(c) ?? c)) };
    if (!best || mapped.melds.flat().length > best.melds.flat().length) best = mapped;
  }
  // Printed jokers that could not copy anything (no chosen cards known) stay at the end.
  return best ?? arrangeHandPlain(hand, ctx);
}

/** Penalty for a card left in hand; a printed joker scores as the highest card it may copy. */
export function penaltyValue(card: Card, wild: ReadonlySet<Card>, rules: ConquerRules, falseJokerAs: readonly Card[] = []): number {
  if (isPrintedJoker(card)) {
    if (falseJokerAs.length === 0) return rules.wild.printedJokerPenalty;
    return Math.max(...falseJokerAs.map((id) => (cardRank(id) === 'A' ? rules.acePenalty : naturalValue(cardRank(id)))));
  }
  return penaltyValuePlain(card, wild, rules);
}
