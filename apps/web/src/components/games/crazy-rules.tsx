'use client';

/** Player-facing Crazy rules, shown in the game lobby (How to play). */
export const CRAZY_RULES: { am: string; en: string; items: string[] }[] = [
  {
    am: 'ጨዋታው',
    en: 'The game',
    items: [
      'Two to five players with a normal 52-card deck.',
      'With 2 players everyone gets 7 cards. With 3 or more players everyone gets 5.',
      'The player who starts gets one extra card (8 with 2 players) and opens the empty pile with any card they like.',
      'The first player to get rid of all their cards wins the pot.',
    ],
  },
  {
    am: 'ተራ',
    en: 'Your turn',
    items: [
      'Play one card that matches the top card of the pile by suit (♥ on ♥) or by rank (7 on 7).',
      'If you cannot play, or do not want to, tap the deck to draw one card. If it fits you can play it straight away; otherwise pass (እለፍ).',
      'Only one card can be drawn per turn.',
      'When the deck runs out, the pile is shuffled to make a new deck. The top card stays where it is.',
      'You have 30 seconds per turn. The first time your time runs out, you draw a card and the turn passes. The second time, you lose the game.',
    ],
  },
  {
    am: 'ልዩ ካርታዎች',
    en: 'Special cards',
    items: [
      '8 and J are wild (★): play one on any card and choose the next suit. The next player must follow that suit or play another 8 or J.',
      '7 carries cards: when you play a 7, you can drop more cards of the same suit with it in one go (7♥ K♥ 3♥). A J or 8 of any suit can be carried too, because they are jokers (7♥ J♣ K♥). The last card you drop is the new top card, and its effect counts.',
      'A 7 played on its own skips the next player, like a 5.',
      '5 skips the next player. With two players, you play again.',
      '2 is draw two: the next player picks up 2 cards. You can answer a 2 with your own 2, and then the next player picks up 4, then 6, and so on.',
      'A♠ is pick up five: the next player picks up 5 cards unless they have the 2♠. The 2♠ passes the pile on (7 cards), and after that any 2 keeps it going.',
      'After you pick up the cards from a 2 or the A♠, it is still your turn: play a card, or draw one and pass.',
    ],
  },
  {
    am: 'መጨረሻ',
    en: 'Winning',
    items: [
      'The game ends as soon as someone plays their last card. You can finish with an 8, a J, or a 7 carrying your last cards.',
      'If nobody can play or draw, the player with the fewest points in hand wins. An 8 or J is worth 50, K Q and 10 are 10, an A is 1, and other cards are their number.',
      'Everyone pays the table stake, and the winner takes the whole pot. Points are virtual and have no cash value.',
    ],
  },
  {
    am: 'ቁልፎች',
    en: 'Buttons',
    items: [
      'Tap a card to lift it, then tap it again (or press ጣል) to play it. Cards you cannot play are dimmed.',
      'With a 7 lifted, tap more cards of its suit (or a J or 8) to add them. They are numbered in the order they will drop. Then tap the 7 or press ጣል.',
      'Tap the deck in the middle to draw a card, or to pick up the cards from a 2 or the A♠.',
      'እለፍ: pass your turn after drawing a card.',
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
