'use client';

/** Player-facing Conquer rules, shown in the lobby and from the Rules button at the table. */
export const CONQUER_RULES: { am: string; en: string; items: string[] }[] = [
  {
    am: 'ጨዋታው',
    en: 'The game',
    items: [
      'One against one with 54 cards: the normal 52 plus two printed jokers.',
      'The starter gets 14 cards and the other player 13. The starter begins by discarding one card.',
      'Win the round by melding all your cards and discarding the last one.',
    ],
  },
  {
    am: 'ጆከር መምረጥ',
    en: 'Choosing the jokers',
    items: [
      'Before the deal one player calls, without seeing the base card: ላይ (Up), ታች (Down), ጎን (Side) or ላይና ታች (Up & Down).',
      'The base card is then turned over and placed face-up under the deck. With base 5♣: ላይ = 6♣ 6♠, ታች = 4♣ 4♠, ጎን = 5♦ 5♥, ላይና ታች = 6♣ 4♣.',
      'These cards are the real jokers (★). A real joker can stand for any card a meld needs.',
      'A printed JOKER card is a false joker: it can only be a copy of one of this round’s joker cards.',
      'The players take turns making the call in each new round.',
    ],
  },
  {
    am: 'ሚሞላ ካርታ',
    en: 'Melds',
    items: [
      'Set: 3 or 4 cards of the same rank in different suits.',
      'Run: 3 or more cards in a row of the same suit. The Ace can be low (A-2-3) or high (Q-K-A), but K-A-2 is not a run.',
      'Only one joker may be used in each meld.',
      'Points: 2–10 are face value, J Q K are 10, and the Ace is 11 (or 1 in A-2-3). A joker counts as the card it stands for.',
    ],
  },
  {
    am: 'መግባት (41)',
    en: 'Going in (41 points)',
    items: [
      'To go in, lay down melds worth 41 points or more in a single turn. You can lay them down one at a time.',
      'If you start laying down melds, you must reach 41 that turn. You cannot discard until you do.',
      'Once you are in, you can lay down melds of any value and add cards to any meld on the table with ጨምር.',
    ],
  },
  {
    am: 'ተራ',
    en: 'Your turn',
    items: [
      'Draw one card from the deck, or take the top discard.',
      'Before you are in, taking the discard means you must reach 41 that same turn. After you are in, you can take it freely.',
      'The base card under the deck can also be taken, but then you must go out that turn.',
      'You then meld (optional) and discard one card to end your turn. When the deck runs out, the discards are shuffled back in, except the top card.',
      'You have 1:30 per turn. If your time runs out, you lose the round.',
    ],
  },
  {
    am: 'የማይጣሉ ካርታዎች',
    en: 'Cards you cannot discard',
    items: [
      'A real joker cannot be discarded: meld it, use it to fill a meld, or keep it.',
      'A card that would fit a meld on the table cannot be discarded either.',
      'If you add a card to a meld on the table, you must go out that same turn, or you lose when time runs out.',
      'Once you are in, you can swap a joker (ጆከር መተካት): give the real card a table joker stands for and take the joker into your hand. You must use it before you discard.',
    ],
  },
  {
    am: 'ቁልፎች',
    en: 'Buttons',
    items: [
      'ውረድ: lay down the selected cards as melds.',
      'ጨምር: add the selected card to a meld on the table that glows green (you can also tap the meld).',
      'ጆከር መተካት: swap a table joker.',
      'ጣል: discard the selected card.',
      'ደርድር: sort your hand with melds first, then near-melds such as pairs and run pieces.',
    ],
  },
  {
    am: 'ነጥብ',
    en: 'Points',
    items: [
      'Each player puts in the table stake every round, and the round winner takes both stakes.',
      'After a round, both players can choose Rematch to play another round.',
      'Points are virtual and have no cash value.',
    ],
  },
];

export function ConquerRulesList({ dense }: { dense?: boolean }) {
  return (
    <div className={`grid ${dense ? 'gap-3' : 'gap-4'}`}>
      {CONQUER_RULES.map((s) => (
        <section key={s.en}>
          <h3 className="mb-1 text-sm font-extrabold">
            <span className="font-ethiopic">{s.am}</span> <span className="font-semibold text-muted">· {s.en}</span>
          </h3>
          <ul className="grid gap-1 text-sm text-muted">
            {s.items.map((r) => (
              <li key={r} className="flex gap-2">
                <span className="text-lime">•</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ConquerRulesSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-[45] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Conquer rules" onClick={onClose}>
      <div className="card flex max-h-full w-full max-w-md flex-col p-0 text-fg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="font-display text-lg font-extrabold">
            <span className="font-ethiopic">ህጎች</span> · Rules
          </div>
          <button className="btn-ghost px-3 py-1 text-xs" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <ConquerRulesList dense />
        </div>
      </div>
    </div>
  );
}
