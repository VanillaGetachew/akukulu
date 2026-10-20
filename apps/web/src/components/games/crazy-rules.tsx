'use client';

/** Player-facing Crazy rules, shown in the game lobby (How to play). */
export const CRAZY_RULES: { am: string; en: string; items: string[] }[] = [
  {
    am: 'ጨዋታው',
    en: 'The game',
    items: [
      'Two to five players with a normal 52-card deck.',
      'With 2 players everyone gets 7 cards. With 3 or more players everyone gets 5.',
      'One card is turned face-up to start the pile. If it is an 8, it goes back into the deck and another card is turned.',
      'The first player to get rid of all their cards wins the pot.',
    ],
  },
  {
    am: 'ተራ',
    en: 'Your turn',
    items: [
      'Play one card that matches the top card of the pile by suit (♥ on ♥) or by rank (7 on 7).',
      'If you cannot play, or do not want to, draw from the deck. You can play a drawn card straight away if it fits.',
      'You can draw up to 3 cards in a turn. If you still cannot play, pass (እለፍ).',
      'When the deck runs out, the pile is shuffled to make a new deck. The top card stays where it is.',
      'You have 30 seconds per turn. If time runs out, a move is made for you. After 3 missed turns in a row you leave the game.',
    ],
  },
  {
    am: 'ልዩ ካርታዎች',
    en: 'Special cards',
    items: [
      '8 is wild (★): play it on any card and choose the next suit. The next player must follow that suit or play another 8.',
      '2 is draw two: the next player draws 2 cards and misses their turn.',
      'You can answer a 2 with your own 2. Then the next player draws 4, then 6, and so on.',
    ],
  },
  {
    am: 'መጨረሻ',
    en: 'Winning',
    items: [
      'The game ends as soon as someone plays their last card. You can finish with an 8.',
      'If nobody can play or draw, the player with the fewest points in hand wins. An 8 is worth 50, K Q J and 10 are 10, an A is 1, and other cards are their number.',
      'Everyone pays the table stake, and the winner takes the whole pot. Points are virtual and have no cash value.',
    ],
  },
  {
    am: 'ቁልፎች',
    en: 'Buttons',
    items: [
      'Tap a card to lift it, then tap it again (or press ጣል) to play it. Cards you cannot play are dimmed.',
      'ውሰድ: draw a card, or take the cards from 2s.',
      'እለፍ: pass when you cannot play.',
      'ደርድር: sort your hand by suit and rank.',
    ],
  },
];

export function CrazyRulesList() {
  return (
    <div className="grid gap-4">
      {CRAZY_RULES.map((s) => (
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
