import { describe, expect, it } from 'vitest';
import { compareHands, evaluateBest, evaluateFive } from './hand-evaluator';

const h = (s: string) => s.split(' ');

describe('poker hand categories', () => {
  const cases: [string, string][] = [
    ['As Kd 9h 7c 3s', 'High Card'],
    ['As Ad 9h 7c 3s', 'One Pair'],
    ['As Ad 9h 9c 3s', 'Two Pair'],
    ['As Ad Ah 7c 3s', 'Three of a Kind'],
    ['5s 6d 7h 8c 9s', 'Straight'],
    ['As 2d 3h 4c 5s', 'Straight'],
    ['Ts Jd Qh Kc As', 'Straight'],
    ['As Ks 9s 7s 3s', 'Flush'],
    ['As Ad Ah 7c 7s', 'Full House'],
    ['As Ad Ah Ac 3s', 'Four of a Kind'],
    ['5h 6h 7h 8h 9h', 'Straight Flush'],
    ['Ah 2h 3h 4h 5h', 'Straight Flush'],
    ['Th Jh Qh Kh Ah', 'Royal Flush'],
  ];
  for (const [cards, category] of cases) {
    it(`${cards} is ${category}`, () => expect(evaluateFive(h(cards)).category).toBe(category));
  }

  it('ranks every category strictly above the previous one', () => {
    const scores = cases.filter((_, i) => ![5, 6, 11].includes(i)).map(([c]) => evaluateFive(h(c)).score);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThan(scores[i - 1]);
  });

  it('does not treat K-A-2-3-4 as a straight (no wrap-around)', () => {
    expect(evaluateFive(h('Ks As 2d 3h 4c')).category).toBe('High Card');
  });
});

describe('poker tie-breaking', () => {
  const beats = (a: string, b: string) => expect(evaluateFive(h(a)).score).toBeGreaterThan(evaluateFive(h(b)).score);
  const ties = (a: string, b: string) => expect(evaluateFive(h(a)).score).toBe(evaluateFive(h(b)).score);

  it('compares high cards and kickers', () => {
    beats('As Kd 9h 7c 4s', 'As Kd 9h 7c 3s');
    beats('Ks Kd Ah 7c 3s', 'Ks Kd Qh Jc 9s');
    beats('Ks Kd 9h 9c 3s', 'Ks Kd 8h 8c As');
    beats('Ks Kd 9h 9c 4s', 'Kh Kc 9s 9d 3h');
  });

  it('ranks trips and full houses by the triple first', () => {
    beats('3s 3d 3h Ac Ks', '2s 2d 2h Ac Ks');
    beats('3s 3d 3h 2c 2s', '2s 2d 2h Ac As');
  });

  it('ranks the wheel as the lowest straight', () => {
    beats('2s 3d 4h 5c 6s', 'As 2d 3h 4c 5s');
    beats('2h 3h 4h 5h 6h', 'Ah 2h 3h 4h 5h');
  });

  it('compares flushes card by card', () => {
    beats('As Js 9s 7s 3s', 'Ah Th 9h 7h 3h');
  });

  it('treats identical ranks in different suits as an exact tie', () => {
    ties('As Kd 9h 7c 3s', 'Ah Kc 9d 7s 3h');
    ties('5s 6d 7h 8c 9s', '5h 6c 7d 8s 9h');
  });
});

describe('best five of seven', () => {
  it('finds a flush over a straight', () => {
    const best = evaluateBest(h('2h 6h 7h 8c 9h Th Js'));
    expect(best.category).toBe('Flush');
    expect(best.best).toHaveLength(5);
  });

  it('finds the best full house among two trips', () => {
    expect(evaluateBest(h('Ks Kd Kh 2c 2s 2d 9h')).best.filter((c) => c[0] === 'K')).toHaveLength(3);
  });

  it('plays the board when it is the best hand', () => {
    const board = h('Ts Js Qs Ks As');
    expect(compareHands([...board, '2c', '3d'], [...board, '4h', '7c'])).toBe(0);
    expect(evaluateBest([...board, '2c', '3d']).category).toBe('Royal Flush');
  });

  it('uses hole cards as kickers', () => {
    const board = h('As Ad 9h 7c 3s');
    expect(compareHands([...board, 'Kh', '2c'], [...board, 'Qh', 'Jc'])).toBeGreaterThan(0);
  });

  it('orders the best cards for display (wheel ace last)', () => {
    expect(evaluateFive(h('As 2d 3h 4c 5s')).best.map((c) => c[0])).toEqual(['5', '4', '3', '2', 'A']);
    expect(evaluateFive(h('3s 3d 3h Ac Ks')).best.slice(0, 3).every((c) => c[0] === '3')).toBe(true);
  });

  it('rejects duplicate cards', () => {
    expect(() => evaluateBest(h('As As 2d 3h 4c'))).toThrow();
  });
});
