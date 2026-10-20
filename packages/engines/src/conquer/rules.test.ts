import { describe, expect, it } from 'vitest';
import { DEFAULT_CONQUER_RULES, type ConquerRules } from '@akukulu/shared';
import { arrangeHand, nearMelds, extendMeld, interpretMeld, layoffOptions, meldOptions, naturalValue, openingPoints, partitionIntoMelds, penaltyValue, selectWildcards, type MeldContext } from './rules';

const h = (s: string) => s.split(' ');
const rules = (patch: Partial<ConquerRules> = {}): ConquerRules => ({ ...DEFAULT_CONQUER_RULES, ...patch });
const ctx = (wild: string[] = [], taken: string[] = [], r = rules()): MeldContext => ({ wild: new Set(wild), taken: new Set(taken), rules: r });
const meld = (cards: string, c = ctx(), hint: Record<string, string> = {}) => interpretMeld(h(cards), c, hint);
const okMeld = (cards: string, c = ctx(), hint: Record<string, string> = {}) => {
  const res = meld(cards, c, hint);
  if (!res.ok) throw new Error(res.error);
  return res.meld;
};

describe('wildcard prediction (owner-confirmed mapping, base 5♣)', () => {
  it('Up (ላይ): one rank up in both suits of the base colour', () => {
    expect(selectWildcards('5c', 'up', rules())).toEqual({ ranks: ['6'], suits: ['s', 'c'], cards: ['6s', '6c'] });
  });
  it('Down (ታች): one rank down in both suits of the base colour', () => {
    expect(selectWildcards('5c', 'down', rules()).cards).toEqual(['4s', '4c']);
    expect(selectWildcards('9h', 'down', rules()).cards).toEqual(['8h', '8d']);
  });
  it('Side (ጎን): the same rank in the opposite colour', () => {
    expect(selectWildcards('5c', 'side', rules()).cards).toEqual(['5h', '5d']);
    expect(selectWildcards('Qd', 'side', rules()).cards).toEqual(['Qs', 'Qc']);
  });
  it('Up & Down (ላይና ታች): the same suit, one rank up and one down', () => {
    expect(selectWildcards('5c', 'upDown', rules()).cards).toEqual(['6c', '4c']);
  });
  it('wraps at the K/A boundary by default', () => {
    expect(selectWildcards('Kd', 'up', rules()).cards).toEqual(['Ah', 'Ad']);
    expect(selectWildcards('As', 'down', rules()).cards).toEqual(['Ks', 'Kc']);
    expect(selectWildcards('Kd', 'upDown', rules()).cards).toEqual(['Ad', 'Qd']);
  });
  it('falls back to the base rank at a boundary when configured to clamp', () => {
    const clamp = rules({ prediction: { ...DEFAULT_CONQUER_RULES.prediction, boundary: 'clamp' } });
    expect(selectWildcards('Kd', 'up', clamp).ranks).toEqual(['K']);
    expect(selectWildcards('As', 'upDown', clamp).ranks).toEqual(['2', 'A']);
  });
});
describe('card values and Aces', () => {
  it('values cards', () => {
    expect([naturalValue('A'), naturalValue('7'), naturalValue('T'), naturalValue('K')]).toEqual([11, 7, 10, 10]);
  });
  it('counts an Ace as 11 in a set', () => expect(okMeld('As Ah Ad').points).toBe(33));
  it('counts an Ace as 1 at the bottom of a run', () => expect(okMeld('Ah 2h 3h').points).toBe(6));
  it('counts an Ace as 11 at the top of a run', () => expect(okMeld('Qh Kh Ah').points).toBe(31));
  it('never wraps K-A-2', () => expect(meld('Kh Ah 2h').ok).toBe(false));
  it('rejects Q-K-A when ace-high runs are disabled', () => {
    expect(meld('Qh Kh Ah', ctx([], [], rules({ runs: { aceHigh: false } }))).ok).toBe(false);
  });
  it('places an Ace by its role even when a wildcard fills the run', () => {
    const run = okMeld('Ah Kh 9c', ctx(['9c']));
    expect(run.placed.map((p) => p.as)).toEqual(['Qh', 'Kh', 'Ah']);
    expect(run.points).toBe(31);
  });
});

describe('sets and runs', () => {
  it('lays sets out alternating red and black: ♥ ♣ ♦ ♠', () => {
    expect(okMeld('9d 9c 9h 9s').placed.map((p) => p.as)).toEqual(['9h', '9c', '9d', '9s']);
  });

  it('accepts sets of three or four distinct suits', () => {
    expect(okMeld('9s 9h 9d').kind).toBe('set');
    expect(okMeld('9s 9h 9d 9c').points).toBe(36);
  });
  it('rejects mixed ranks, duplicates, two-card and five-card groups', () => {
    expect(meld('9s 9h 8d').ok).toBe(false);
    expect(meld('9s 9s 9d').ok).toBe(false);
    expect(meld('9s 9h').ok).toBe(false);
  });
  it('accepts same-suit consecutive runs of any length', () => {
    expect(okMeld('5h 6h 7h').points).toBe(18);
    expect(okMeld('9d Td Jd Qd Kd').points).toBe(49);
  });
  it('rejects mixed suits and gaps', () => {
    expect(meld('5h 6h 7d').ok).toBe(false);
    expect(meld('5h 6h 8h').ok).toBe(false);
  });
});

describe('wildcards in melds', () => {
  const wild = ['8s', '8h', '8d', '8c'];
  it('fills a gap in a run', () => {
    const run = okMeld('5h 6h 8c', ctx(wild));
    expect(run.placed.map((p) => [p.card, p.as, p.wild])).toEqual([
      ['5h', '5h', false],
      ['6h', '6h', false],
      ['8c', '7h', true],
    ]);
  });
  it('chooses the higher-scoring end unless a hint pins it', () => {
    expect(okMeld('5h 6h 8c', ctx(['8c'])).placed[2].as).toBe('7h');
    expect(okMeld('5h 6h 8c', ctx(['8c']), { '8c': '4h' }).placed[0].as).toBe('4h');
  });
  it('plays a wildcard as itself when it fits naturally', () => {
    const run = okMeld('6c 7c 8c', ctx(wild));
    expect(run.placed.every((p) => !p.wild)).toBe(true);
  });
  it('substitutes for a missing suit in a set', () => {
    const set = okMeld('9s 9h 8c', ctx(wild));
    expect(set.placed.map((p) => p.as)).toEqual(['9h', '9s', '9d']); // red and black alternate
    expect(set.points).toBe(27);
  });
  it('requires at least two natural cards per meld', () => {
    const res = meld('5h 8c 8d', ctx(wild));
    expect(res.ok).toBe(false);
  });
  it('never represents a card already on the table', () => {
    expect(okMeld('9s 9h 8c', ctx(wild, ['9d'])).placed.map((p) => p.as)).toEqual(['9c', '9h', '9s']);
    const res = meld('7h 7s 7d', ctx(wild, ['7h']));
    expect(res.ok === false && res.error).toMatch(/already represents 7h/);
  });
  it('rejects hints for non-wild cards', () => expect(meld('5h 6h 7h', ctx(), { '7h': '4h' }).ok).toBe(false));
  it('values wildcards for the opening by what they represent, or a fixed value', () => {
    const run = okMeld('5h 6h 8c', ctx(wild));
    expect(openingPoints(run, rules())).toBe(18);
    expect(openingPoints(run, rules({ wild: { ...DEFAULT_CONQUER_RULES.wild, openingValue: 20 } }))).toBe(31);
  });
});

describe('laying off', () => {
  it('extends runs at either end only', () => {
    const run = okMeld('5h 6h 7h');
    expect(extendMeld(run, '8h', ctx()).ok).toBe(true);
    expect(extendMeld(run, '4h', ctx()).ok).toBe(true);
    expect(extendMeld(run, '9h', ctx()).ok).toBe(false);
    expect(extendMeld(run, '8d', ctx()).ok).toBe(false);
  });
  it('completes sets up to four cards', () => {
    const set = okMeld('9s 9h 9d');
    const four = extendMeld(set, '9c', ctx());
    expect(four.ok).toBe(true);
    if (four.ok) expect(extendMeld(four.meld, '8c', ctx(['8c'])).ok).toBe(false);
  });
  it('lays off a wildcard at the chosen end, keeping existing identities fixed', () => {
    const run = okMeld('5h 6h 7h');
    const res = extendMeld(run, '8c', ctx(['8c']), '4h');
    expect(res.ok && res.meld.placed.map((p) => p.as)).toEqual(['4h', '5h', '6h', '7h']);
  });
  it('extends an Ace-low run upward and an Ace-high run downward', () => {
    expect(extendMeld(okMeld('Ah 2h 3h'), '4h', ctx()).ok).toBe(true);
    const high = extendMeld(okMeld('Qh Kh Ah'), 'Jh', ctx());
    expect(high.ok && high.meld.points).toBe(41);
  });
});

describe('penalties', () => {
  it('scores cards left in hand', () => {
    const w = new Set(['8c']);
    expect(['Ah', 'Kd', '5s', '8c'].map((c) => penaltyValue(c, w, rules()))).toEqual([11, 10, 5, 8]);
    expect(penaltyValue('8c', w, rules({ wild: { ...DEFAULT_CONQUER_RULES.wild, penalty: 25 } }))).toBe(25);
  });
});

describe('meld partitioning (lay down the selected cards)', () => {
  const norm = (melds: string[][] | null) => melds?.map((m) => [...m].sort()).sort() ?? null;
  it('splits a selection into valid melds', () => {
    expect(norm(partitionIntoMelds(h('3s 4s 5s Kh Kd Kc'), ctx()))).toEqual([['3s', '4s', '5s'], ['Kc', 'Kd', 'Kh']]);
  });
  it('uses wildcards to fill gaps', () => {
    expect(partitionIntoMelds(h('5h 6h 8c'), ctx(['8c']))).toEqual([['5h', '6h', '8c']]);
    expect(partitionIntoMelds(h('5h 6h 8c 9s 9d 9h'), ctx(['8c']))).toHaveLength(2);
  });
  it('returns null when some card cannot be melded', () => {
    expect(partitionIntoMelds(h('3s 4s 5s Kh'), ctx())).toBeNull();
    expect(partitionIntoMelds(h('3s 4s'), ctx())).toBeNull();
  });
});

describe('optimum hand order', () => {
  it('puts the best melds first, then the rest by suit and rank', () => {
    const hand = h('Kc 9d 5s Kh 3s 8c 4s Qd Kd 2h');
    const { order, melds } = arrangeHand(hand, ctx(['8c']));
    expect(melds.map((m) => [...m].sort()).sort()).toEqual([['3s', '4s', '5s'], ['8c', 'Kc', 'Kd', 'Kh']]);
    expect(order.slice(-3)).toEqual(['2h', '9d', 'Qd']);
    expect([...order].sort()).toEqual([...hand].sort());
  });
  it('places a wildcard in the gap it fills', () => {
    expect(arrangeHand(h('7d 5h 8c 6h'), ctx(['8c'])).order).toEqual(['5h', '6h', '8c', '7d']);
  });
  it('keeps unmatched wildcards last', () => {
    expect(arrangeHand(h('8c Kd 2h'), ctx(['8c'])).order).toEqual(['2h', 'Kd', '8c']);
  });
});
describe('joker choices', () => {
  const asOf = (m: { placed: { card: string; as: string }[] }, joker: string) => m.placed.find((p) => p.card === joker)!.as;
  it('offers every end a joker can fill in a run, best first', () => {
    const options = meldOptions(h('5h 6h 8c'), ctx(['8c']));
    expect(options.map((o) => asOf(o, '8c'))).toEqual(['7h', '4h']);
  });
  it('offers every free suit for a joker in a set', () => {
    expect(meldOptions(h('9s 9h 8c'), ctx(['8c'])).map((o) => asOf(o, '8c')).sort()).toEqual(['9c', '9d']);
    expect(meldOptions(h('9s 9h 8c'), ctx(['8c'], ['9d'])).map((o) => asOf(o, '8c'))).toEqual(['9c']);
  });
  it('has a single option when nothing is ambiguous', () => {
    expect(meldOptions(h('5h 6h 7h'), ctx())).toHaveLength(1);
    expect(meldOptions(h('5h 8c 7h'), ctx(['8c']))).toHaveLength(1);
  });
  it('lists lay-off positions for a joker', () => {
    const run = interpretMeld(h('5h 6h 7h'), ctx());
    if (!run.ok) throw new Error(run.error);
    expect(layoffOptions(run.meld, '8c', ctx(['8c'])).map((o) => asOf(o, '8c')).sort()).toEqual(['4h', '8h']);
    expect(layoffOptions(run.meld, '8h', ctx())).toHaveLength(1);
  });
});
describe('false (printed) jokers and the one-joker limit', () => {
  // Base 5♦ + Up → the chosen jokers are 6♦ and 6♥; a printed joker can only be 6♦ or 6♥.
  const chosen = ['6d', '6h'];
  const fx = (extraWild: string[] = [], taken: string[] = []): MeldContext => ({ ...ctx([...chosen, ...extraWild], taken), falseJokerAs: chosen });
  const of = (m: { placed: { card: string; as: string; wild: boolean }[] }, card: string) => m.placed.find((p) => p.card === card)!;

  it('plays only as one of the chosen cards, as a natural card', () => {
    const run = okMeld('5d X1 7d', fx());
    expect(of(run, 'X1')).toMatchObject({ as: '6d', wild: false });
    expect(['6d', '6h']).toContain(of(okMeld('6s 6c X1', fx()), 'X1').as);
  });
  it('cannot stand in for any other card', () => {
    expect(meld('Kh Kd X1', fx()).ok).toBe(false);
    expect(meld('5h X1 8h', fx()).ok).toBe(false);
    expect(meld('5d 6d X1', fx()).ok).toBe(false); // 6♦ is already in the meld, 6♥ does not fit
  });
  it('does not count as a joker, so a real joker can join the same meld', () => {
    const run = okMeld('5d X1 7d 6h', fx());
    expect(run.placed.filter((p) => p.wild).map((p) => p.card)).toEqual(['6h']);
    expect(okMeld('6s X1 X2', fx()).placed.every((p) => !p.wild)).toBe(true);
  });
  it('never allows two real jokers in one meld', () => {
    const jokers = ['8c', '8s'];
    expect(meld('5h 6h 8c 8s', ctx(jokers)).ok).toBe(false);
    expect(meld('9s 9h 8c 8s', ctx(jokers)).ok).toBe(false);
    expect(meldOptions(h('5h 6h 8c 8s'), ctx(jokers))).toEqual([]);
    const run = okMeld('5h 6h 8c', ctx(jokers));
    expect(extendMeld(run, '8s', ctx(jokers)).ok).toBe(false);
  });
  it('lays a false joker off as a chosen card', () => {
    const run = okMeld('3d 4d 5d', fx());
    const res = extendMeld(run, 'X2', fx());
    expect(res.ok && of(res.meld, 'X2')).toMatchObject({ as: '6d', wild: false });
    expect(layoffOptions(run, 'X2', fx()).length).toBe(1);
    expect(extendMeld(okMeld('9s 9h 9c'), 'X1', fx()).ok).toBe(false);
  });
  it('never puts a card and the false joker copying it in one meld', () => {
    // 6♦ is a joker; a false joker copying 6♦ cannot share a meld with the real 6♦.
    const run = okMeld('4d 5d X1', fx());
    expect(of(run, 'X1').as).toBe('6d');
    expect(extendMeld(run, '6d', fx()).ok).toBe(false);
  });

  it('partitions and arranges hands containing false jokers', () => {
    expect(partitionIntoMelds(h('5d X1 7d 6s 6c X2'), fx())).toHaveLength(2);
    const { melds } = arrangeHand(h('5d X1 7d Kd 2c'), fx());
    expect(melds).toEqual([['5d', 'X1', '7d']]);
  });
  it('scores a false joker left in hand as the card it copies', () => {
    expect(penaltyValue('X1', new Set(chosen), rules(), chosen)).toBe(6);
  });
});
describe('best order groups near-melds', () => {
  it('puts pairs and run fragments together before single cards', () => {
    const { order } = arrangeHand(h('Kd 2c 5h Qs 7h Kh 9d'), ctx());
    // 5♥-7♥ (one gap) and K♥ K♦ (pair) come before the singles 2♣ 9♦ Q♠.
    expect(order.slice(0, 4)).toEqual(['5h', '7h', 'Kh', 'Kd']);
    expect(order.slice(4).sort()).toEqual(['2c', '9d', 'Qs']);
  });
  it('keeps jokers after everything else', () => {
    const { groups, singles } = nearMelds(h('8c 5s 6s Ad'), ctx(['8c']));
    expect(groups).toEqual([['5s', '6s']]);
    expect(singles).toEqual(['Ad', '8c']);
  });
});