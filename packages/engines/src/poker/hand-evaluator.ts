import { HAND_CATEGORIES, cardRank, cardSuit, type Card, type HandCategory } from '@akukulu/shared';

const RANK_VALUE: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14,
};

export interface EvaluatedHand {
  /** Higher is better; equal scores tie exactly. */
  score: number;
  categoryIndex: number;
  category: HandCategory;
  /** The five cards forming the hand, ordered by significance. */
  best: Card[];
}

function encode(categoryIndex: number, kickers: number[]): number {
  // category in the top "digit", then up to five base-15 kicker digits.
  let score = categoryIndex;
  for (let i = 0; i < 5; i++) score = score * 15 + (kickers[i] ?? 0);
  return score;
}

/** Highest card of a straight in `values` (distinct, any order), or 0. Handles the A-2-3-4-5 wheel. */
function straightHigh(values: number[]): number {
  const set = new Set(values);
  if (set.has(14)) set.add(1);
  for (let high = 14; high >= 5; high--) {
    let run = true;
    for (let v = high; v > high - 5; v--) if (!set.has(v)) { run = false; break; }
    if (run) return high;
  }
  return 0;
}

/** Evaluates exactly five cards. */
export function evaluateFive(cards: Card[]): EvaluatedHand {
  if (cards.length !== 5) throw new Error('evaluateFive requires 5 cards');
  const values = cards.map((c) => RANK_VALUE[cardRank(c)]);
  const flush = cards.every((c) => cardSuit(c) === cardSuit(cards[0]));
  const distinct = [...new Set(values)];
  const high = distinct.length === 5 ? straightHigh(distinct) : 0;

  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  // Groups ordered by size, then rank.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]).join('');
  const groupRanks = groups.map((g) => g[0]);

  let categoryIndex: number;
  let kickers: number[];
  if (high && flush) {
    categoryIndex = 8;
    kickers = [high];
  } else if (shape === '41') {
    categoryIndex = 7;
    kickers = groupRanks;
  } else if (shape === '32') {
    categoryIndex = 6;
    kickers = groupRanks;
  } else if (flush) {
    categoryIndex = 5;
    kickers = [...values].sort((a, b) => b - a);
  } else if (high) {
    categoryIndex = 4;
    kickers = [high];
  } else if (shape === '311') {
    categoryIndex = 3;
    kickers = groupRanks;
  } else if (shape === '221') {
    categoryIndex = 2;
    kickers = groupRanks;
  } else if (shape === '2111') {
    categoryIndex = 1;
    kickers = groupRanks;
  } else {
    categoryIndex = 0;
    kickers = [...values].sort((a, b) => b - a);
  }

  // Order the cards to match significance (wheel: ace plays low).
  const significance = (c: Card) => {
    let v = RANK_VALUE[cardRank(c)];
    if ((categoryIndex === 4 || categoryIndex === 8) && high === 5 && v === 14) v = 1;
    return (counts.get(RANK_VALUE[cardRank(c)]) ?? 0) * 100 + v;
  };
  const best = [...cards].sort((a, b) => significance(b) - significance(a));

  const category: HandCategory = categoryIndex === 8 && high === 14 ? 'Royal Flush' : HAND_CATEGORIES[categoryIndex];
  return { score: encode(categoryIndex, kickers), categoryIndex, category, best };
}

/** Best five-card hand from 5–7 cards. */
export function evaluateBest(cards: Card[]): EvaluatedHand {
  if (cards.length < 5 || cards.length > 7) throw new Error('evaluateBest requires 5 to 7 cards');
  if (new Set(cards).size !== cards.length) throw new Error('duplicate cards');
  let best: EvaluatedHand | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const hand = evaluateFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || hand.score > best.score) best = hand;
          }
  return best!;
}

/** Positive if a beats b, negative if b beats a, 0 for a tie. */
export function compareHands(a: Card[], b: Card[]): number {
  return evaluateBest(a).score - evaluateBest(b).score;
}

const RANK_NAME: Record<string, [string, string]> = {
  '2': ['Two', 'Twos'], '3': ['Three', 'Threes'], '4': ['Four', 'Fours'], '5': ['Five', 'Fives'], '6': ['Six', 'Sixes'],
  '7': ['Seven', 'Sevens'], '8': ['Eight', 'Eights'], '9': ['Nine', 'Nines'], T: ['Ten', 'Tens'], J: ['Jack', 'Jacks'],
  Q: ['Queen', 'Queens'], K: ['King', 'Kings'], A: ['Ace', 'Aces'],
};

/**
 * Plain-words name of the best hand in `cards` (hole cards plus whatever board is out):
 * "Ace High", "Pair of Kings", "Two Pair, Aces & Kings", "Full House, Sevens over Twos".
 * Null for fewer than two cards.
 */
export function describeHand(cards: Card[]): string | null {
  if (cards.length < 2) return null;
  const one = (c: Card) => RANK_NAME[cardRank(c)][0];
  const many = (c: Card) => RANK_NAME[cardRank(c)][1];
  if (cards.length < 5) {
    const sorted = [...cards].sort((a, b) => RANK_VALUE[cardRank(b)] - RANK_VALUE[cardRank(a)]);
    const pair = sorted.find((c, i) => sorted.some((d, j) => j !== i && cardRank(d) === cardRank(c)));
    return pair ? `Pair of ${many(pair)}` : `${one(sorted[0])} High`;
  }
  const { categoryIndex, category, best } = evaluateBest(cards);
  switch (categoryIndex) {
    case 0: return `${one(best[0])} High`;
    case 1: return `Pair of ${many(best[0])}`;
    case 2: return `Two Pair, ${many(best[0])} & ${many(best[2])}`;
    case 3: return `Three of a Kind, ${many(best[0])}`;
    case 4: return `Straight, ${one(best[0])} High`;
    case 5: return `Flush, ${one(best[0])} High`;
    case 6: return `Full House, ${many(best[0])} over ${many(best[3])}`;
    case 7: return `Four of a Kind, ${many(best[0])}`;
    default: return category === 'Royal Flush' ? 'Royal Flush' : `Straight Flush, ${one(best[0])} High`;
  }
}
