/**
 * Cards are two-character codes: rank + suit, e.g. "Ah", "Td", "7c".
 * Ranks: 2 3 4 5 6 7 8 9 T J Q K A. Suits: s h d c.
 */
export type Card = string;

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export const SUITS = ['s', 'h', 'd', 'c'] as const;
export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];

/** Placeholder sent to clients in place of a card they may not see. */
export const HIDDEN_CARD = '??';

export function cardRank(card: Card): Rank {
  return card[0] as Rank;
}

export function cardSuit(card: Card): Suit {
  return card[1] as Suit;
}

export function isValidCard(card: unknown): card is Card {
  return (
    typeof card === 'string' &&
    card.length === 2 &&
    (RANKS as readonly string[]).includes(card[0]) &&
    (SUITS as readonly string[]).includes(card[1])
  );
}

export function standardDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(`${r}${s}`);
  return deck;
}

export const SUIT_SYMBOL: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const RANK_LABEL: Record<Rank, string> = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A',
};
