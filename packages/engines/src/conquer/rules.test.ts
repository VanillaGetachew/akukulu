import { describe, expect, it } from 'vitest';
import { DEFAULT_CONQUER_RULES, type ConquerRules } from '@akukulu/shared';
import { extendMeld, interpretMeld, naturalValue, openingPoints, penaltyValue, selectWildcards, type MeldContext } from './rules';

const h = (s: string) => s.split(' ');
const rules = (patch: Partial<ConquerRules> = {}): ConquerRules => ({ ...DEFAULT_CONQUER_RULES, ...patch });
const ctx = (wild: string[] = [], taken: string[] = [], r = rules()): MeldContext => ({ wild: new Set(wild), taken: new Set(taken), rules: r });
const meld = (cards: string, c = ctx(), hint: Record<string, string> = {}) => interpretMeld(h(cards), c, hint);
const okMeld = (cards: string, c = ctx(), hint: Record<string, string> = {}) => {
  const res = meld(cards, c, hint);
  if (!res.ok) throw new Error(res.error);
  return res.meld;
};

describe('wildcard prediction', () => {
  it('Up selects the next rank in every suit', () => {
    expect(selectWildcards('7h', 'up', rules())).toEqual({ ranks: ['8'], suits: null, cards: ['8s', '8h', '8d', '8c'] });
  });
  it('Down selects the previous rank', () => {
    expect(selectWildcards('7h', 'down', rules()).ranks).toEqual(['6']);
  });
  it('Up & Down selects both neighbours (eight cards)', () => {
    const sel = selectWildcards('7h', 'upDown', rules());
    expect(sel.ranks).toEqual(['8', '6']);
    expect(sel.cards).toHaveLength(8);
  });
  it('Side selects the base rank, optionally filtered by colour', () => {
    expect(selectWildcards('7h', 'side', rules()).cards).toEqual(['7s', '7h', '7d', '7c']);
    const same = rules({ prediction: { ...DEFAULT_CONQUER_RULES.prediction, side: 'sameRankSameColor' } });
    expect(selectWildcards('7h', 'side', same).cards).toEqual(['7h', '7d']);
    const other = rules({ prediction: { ...DEFAULT_CONQUER_RULES.prediction, side: 'sameRankOtherColor' } });
    expect(selectWildcards('7h', 'side', other).cards).toEqual(['7s', '7c']);
  });
  it('wraps at the K/A boundary by default', () => {
    expect(selectWildcards('Kd', 'up', rules()).ranks).toEqual(['A']);
    expect(selectWildcards('As', 'down', rules()).ranks).toEqual(['K']);
    expect(selectWildcards('Kd', 'upDown', rules()).ranks).toEqual(['A', 'Q']);
    expect(selectWildcards('Td', 'up', rules()).ranks).toEqual(['J']);
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
    expect(set.placed.map((p) => p.as)).toEqual(['9s', '9h', '9d']);
    expect(set.points).toBe(27);
  });
  it('requires at least two natural cards per meld', () => {
    const res = meld('5h 8c 8d', ctx(wild));
    expect(res.ok).toBe(false);
  });
  it('never represents a card already on the table', () => {
    expect(okMeld('9s 9h 8c', ctx(wild, ['9d'])).placed.map((p) => p.as)).toEqual(['9s', '9h', '9c']);
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
